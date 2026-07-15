//! Local projection of the compacted `device.configured` Kafka topic.
//!
//! Replaces the former 120s database polling: instead of reading
//! `physical_devices` and `metric_points`, the service replays the compacted
//! topic at startup into an in-memory map and then follows it live. The
//! database is only written to (measurements, ingestion errors), never read
//! on the ingestion path.

use anyhow::{Context, Result};
use prost::Message as ProstMessage;
use rdkafka::config::ClientConfig;
use rdkafka::consumer::{Consumer, StreamConsumer};
use rdkafka::topic_partition_list::{Offset, TopicPartitionList};
use rdkafka::Message as KafkaMessage;
use serde_json::json;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use tracing::{debug, info, warn};

use crate::config::KafkaConfig;
use crate::proto::device::v1::DeviceConfig;

/// Decoded per-device state.
#[derive(Debug, Clone)]
pub struct DeviceState {
    pub accepted: bool,
    /// Signal map in the JSON shape the parsers consume:
    /// `{ "<metric_id>": { "name", "unit", "source", "field", "min", "max" } }`
    /// (the shape formerly reconstructed from `metric_points` via SQL).
    pub signal_map: Option<serde_json::Value>,
}

/// Shared, continuously updated device-config projection.
#[derive(Clone)]
pub struct DeviceStateStore {
    states: Arc<RwLock<HashMap<String, DeviceState>>>,
}

impl DeviceStateStore {
    /// Replay the compacted topic from the beginning, then keep following it
    /// in a background task. Returns only after the initial replay caught up
    /// to the high watermarks, so MQTT processing starts with complete state.
    pub async fn start(cfg: &KafkaConfig) -> Result<Self> {
        let consumer: StreamConsumer = ClientConfig::new()
            .set("bootstrap.servers", &cfg.bootstrap_servers)
            .set("client.id", format!("{}-device-config", cfg.client_id))
            // Compacted state topic: every instance replays the full topic and
            // never commits offsets, so no consumer-group coordination happens.
            .set("group.id", format!("{}-device-config", cfg.client_id))
            .set("enable.auto.commit", "false")
            .create()
            .context("Failed to create device-config consumer")?;

        let topic = cfg.device_config_topic.clone();

        // The topic is provisioned by device-management; wait until it exists.
        let partitions = wait_for_topic(&consumer, &topic).await?;

        let mut assignment = TopicPartitionList::new();
        let mut high_watermarks: HashMap<i32, i64> = HashMap::new();
        for partition in &partitions {
            assignment.add_partition_offset(&topic, *partition, Offset::Beginning)?;
            let (low, high) = consumer
                .fetch_watermarks(&topic, *partition, Duration::from_secs(10))
                .context("Failed to fetch watermarks")?;
            high_watermarks.insert(*partition, high);
            debug!(partition, low, high, "device.configured watermarks");
        }
        consumer.assign(&assignment)?;

        let states: Arc<RwLock<HashMap<String, DeviceState>>> = Arc::new(RwLock::new(HashMap::new()));

        // ── Initial replay until every partition reached its high watermark ──
        let mut caught_up: HashMap<i32, bool> = high_watermarks
            .iter()
            .map(|(p, high)| (*p, *high == 0))
            .collect();

        while caught_up.values().any(|done| !done) {
            match tokio::time::timeout(Duration::from_secs(5), consumer.recv()).await {
                Ok(Ok(msg)) => {
                    let partition = msg.partition();
                    let offset = msg.offset();
                    apply_message(&states, msg.key(), msg.payload()).await;
                    if let Some(high) = high_watermarks.get(&partition) {
                        if offset + 1 >= *high {
                            caught_up.insert(partition, true);
                        }
                    }
                }
                Ok(Err(e)) => warn!(error = ?e, "Kafka error during device-config replay"),
                Err(_elapsed) => {
                    // No message for a while: partitions may be fully compacted
                    // or empty. Re-check positions against fresh watermarks.
                    for partition in &partitions {
                        if caught_up.get(partition).copied().unwrap_or(true) {
                            continue;
                        }
                        if let Ok((low, high)) =
                            consumer.fetch_watermarks(&topic, *partition, Duration::from_secs(5))
                        {
                            let position = current_position(&consumer, &topic, *partition);
                            if high <= low || position.map_or(false, |p| p >= high) {
                                caught_up.insert(*partition, true);
                            }
                        }
                    }
                }
            }
        }

        let device_count = states.read().await.len();
        info!(
            "Device-config replay complete: {} devices loaded from {}",
            device_count, topic
        );

        // ── Follow live updates for the rest of the process lifetime ──
        let live_states = states.clone();
        tokio::spawn(async move {
            loop {
                match consumer.recv().await {
                    Ok(msg) => apply_message(&live_states, msg.key(), msg.payload()).await,
                    Err(e) => {
                        warn!(error = ?e, "Kafka error on device-config stream — retrying");
                        tokio::time::sleep(Duration::from_secs(1)).await;
                    }
                }
            }
        });

        Ok(Self { states })
    }

    /// Gate check: is this device configured and accepted?
    pub async fn is_accepted(&self, device_id: &str) -> bool {
        self.states
            .read()
            .await
            .get(device_id)
            .map(|s| s.accepted)
            .unwrap_or(false)
    }

    /// Signal map for the device, cloned in the parsers' JSON shape.
    pub async fn signal_map(&self, device_id: &str) -> Option<serde_json::Value> {
        self.states
            .read()
            .await
            .get(device_id)
            .and_then(|s| s.signal_map.clone())
    }
}

/// Block until the topic exists and return its partition ids.
async fn wait_for_topic(consumer: &StreamConsumer, topic: &str) -> Result<Vec<i32>> {
    loop {
        if let Ok(metadata) = consumer.fetch_metadata(Some(topic), Duration::from_secs(10)) {
            if let Some(t) = metadata.topics().iter().find(|t| t.name() == topic) {
                if t.error().is_none() && !t.partitions().is_empty() {
                    return Ok(t.partitions().iter().map(|p| p.id()).collect());
                }
            }
        }
        warn!(
            topic,
            "Topic not available yet (is device-management running?) — retrying in 5s"
        );
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
}

fn current_position(consumer: &StreamConsumer, topic: &str, partition: i32) -> Option<i64> {
    let position = consumer.position().ok()?;
    position
        .find_partition(topic, partition)
        .and_then(|p| match p.offset() {
            Offset::Offset(o) => Some(o),
            _ => None,
        })
}

/// Apply one record: tombstone removes the device, otherwise decode and store.
async fn apply_message(
    states: &Arc<RwLock<HashMap<String, DeviceState>>>,
    key: Option<&[u8]>,
    payload: Option<&[u8]>,
) {
    let Some(device_id) = key.and_then(|k| std::str::from_utf8(k).ok()) else {
        warn!("device.configured record without a valid UTF-8 key — skipping");
        return;
    };

    match payload {
        None => {
            states.write().await.remove(device_id);
            info!(device_id, "Device config removed (tombstone)");
        }
        Some(bytes) => match DeviceConfig::decode(bytes) {
            Ok(config) => {
                let state = to_state(&config);
                debug!(
                    device_id,
                    accepted = state.accepted,
                    signals = config.signals.len(),
                    "Device config updated"
                );
                states.write().await.insert(device_id.to_string(), state);
            }
            Err(e) => warn!(device_id, error = ?e, "Undecodable DeviceConfig — skipping"),
        },
    }
}

fn to_state(config: &DeviceConfig) -> DeviceState {
    let signal_map = if config.signals.is_empty() {
        None
    } else {
        let entries: serde_json::Map<String, serde_json::Value> = config
            .signals
            .iter()
            .map(|s| {
                (
                    s.metric_id.to_string(),
                    json!({
                        "name": s.name,
                        "unit": s.unit,
                        "source": s.source,
                        "field": s.field,
                        "min": s.min_value,
                        "max": s.max_value,
                    }),
                )
            })
            .collect();
        Some(serde_json::Value::Object(entries))
    };

    DeviceState {
        accepted: config.accepted,
        signal_map,
    }
}
