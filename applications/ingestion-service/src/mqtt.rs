//! MQTT client and message handling
//!
//! Supports message format:
//! - Shelly Gen2+ native MQTT (topic-based routing, e.g., `<device-id>/status/temperature:0`)
//! 

use anyhow::{anyhow, Result};
use chrono::{DateTime, Utc};
use deadpool_postgres::Pool;
use rumqttc::{AsyncClient, Event, MqttOptions, Packet, QoS};
use std::sync::Arc;
use std::time::Duration;
use tracing::{debug, error, info};

use crate::config::MqttConfig;
use crate::db;
use crate::device_state::DeviceStateStore;
use crate::parser;
use crate::publisher::{IngestedPoint, MeasurementPublisher};

/// Run the MQTT client and message processing loop.
///
/// Device configs (gate + signal maps) come from the `device.configured`
/// projection in `device_state`; the database is only written to.
pub async fn run(
    cfg: &MqttConfig,
    pool: Pool,
    publisher: MeasurementPublisher,
    device_state: DeviceStateStore,
) -> Result<()> {
    let publisher = Arc::new(publisher);
    let mut mqtt_options = MqttOptions::new(&cfg.client_id, &cfg.host, cfg.port);
    mqtt_options.set_keep_alive(Duration::from_secs(30));

    // Set credentials if configured (required for authenticated brokers)
    if let (Some(username), Some(password)) = (&cfg.username, &cfg.password) {
        mqtt_options.set_credentials(username, password);
        info!("MQTT credentials set for user: {}", username);
    }

    let (client, mut eventloop) = AsyncClient::new(mqtt_options, 100);

    // Subscribe to the primary topic (envelope format from edge gateways)
    client.subscribe(&cfg.topic, QoS::AtLeastOnce).await?;
    info!("Subscribed to MQTT topic: {}", cfg.topic);

    // Subscribe to extra topics (Shelly native, etc.)
    for extra_topic in &cfg.extra_topics {
        client.subscribe(extra_topic, QoS::AtLeastOnce).await?;
        info!("Subscribed to extra MQTT topic: {}", extra_topic);
    }

    // Process incoming messages
    loop {
        match eventloop.poll().await {
            Ok(Event::Incoming(Packet::Publish(publish))) => {
                // System entry for the evaluation (thesis ch. 6). Stamped here
                // on the event loop rather than inside the spawned task, so the
                // queueing and parsing cost below counts towards ingest latency
                // instead of vanishing before the first measurement is built.
                let received_at = Utc::now();
                let topic = publish.topic.clone();
                let payload = String::from_utf8_lossy(&publish.payload).to_string();

                debug!("Received message on {}: {}", topic, payload);

                // Process in a spawned task to not block the event loop
                let pool_clone = pool.clone();
                let state_clone = device_state.clone();

                let publisher_clone = publisher.clone();
                tokio::spawn(async move {
                    if let Err(e) = process_message(&pool_clone, &state_clone, &publisher_clone, &topic, &payload, received_at).await {
                        error!("Error processing message on {}: {:?}", topic, e);

                        // Log to ingestion_errors table
                        if let Err(db_err) = db::insert_error(&pool_clone, &payload, &e.to_string()).await {
                            error!("Failed to log ingestion error: {:?}", db_err);
                        }
                    }
                });
            }
            Ok(Event::Incoming(Packet::ConnAck(_))) => {
                info!("Connected to MQTT broker");
                // Re-establish subscriptions on every (re)connect: rumqttc
                // does not restore them after a reconnect, which would leave
                // the service connected but deaf to device traffic.
                client.subscribe(&cfg.topic, QoS::AtLeastOnce).await?;
                for extra_topic in &cfg.extra_topics {
                    client.subscribe(extra_topic, QoS::AtLeastOnce).await?;
                }
            }
            Ok(_) => {
                // Other events (ping, etc.)
            }
            Err(e) => {
                error!("MQTT error: {:?}", e);
                // Brief pause before reconnecting
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        }
    }
}

/// Process a single MQTT message.
///
/// Routing logic:
/// 1. Try Shelly native format (topic-based detection via `/status/` in topic)
/// 2. Try Tasmota format (`tele/<device_id>/<type>` or `stat/<device_id>/<type>`)
/// 3. Try generic device format (first topic segment = device_id, rest = source)
///
/// `received_at` is when the event loop took this message off MQTT. It is
/// persisted per measurement for the evaluation, and it is handed to the
/// parsers as the fallback measurement timestamp: each route prefers a clock
/// carried in the payload and falls back to this one when the wire format has
/// none (see `parser::resolve_source_time`).
async fn process_message(
    pool: &Pool,
    device_state: &DeviceStateStore,
    publisher: &MeasurementPublisher,
    topic: &str,
    payload: &str,
    received_at: DateTime<Utc>,
) -> Result<()> {
    // Route 1: Check if this is a native Shelly message (topic-based detection)
    if let Some(shelly_info) = parser::parse_shelly_topic(topic) {
        // Gate: drop messages from devices without an accepted config
        if !device_state.is_accepted(&shelly_info.device_id).await {
            info!(
                "Dropping Shelly message from unconfigured device: {}",
                shelly_info.device_id
            );
            return Ok(());
        }

        // Fallback measurement time; the parser prefers a payload clock.
        let timestamp = received_at;

        // Signal map from the device.configured projection resolves channel → metric_id
        let signal_map = device_state.signal_map(&shelly_info.device_id).await;

        let measurements = parser::parse_shelly(&shelly_info, payload, timestamp, signal_map.as_ref())?;
        let count = measurements.len();

        for m in &measurements {
            db::insert_measurement(pool, &shelly_info.device_id, m.metric_id, m.value, m.time, received_at).await?;
            debug!(
                "Inserted (Shelly): device={}, metric={}, value={}",
                shelly_info.device_id, m.metric_id, m.value
            );
        }

        if count > 0 {
            info!(
                "Processed {} Shelly measurements from device {} ({})",
                count, shelly_info.device_id, shelly_info.component
            );

            // Publish batch for threshold evaluation in core-platform (fire-and-forget)
            let points: Vec<IngestedPoint> = measurements
                .iter()
                .map(|m| IngestedPoint { metric_id: m.metric_id, value: m.value, time: m.time })
                .collect();
            publisher.publish_batch(&shelly_info.device_id, &points).await;
        }
        return Ok(());
    }

    // Route 2: Tasmota devices (tele/<device_id>/<type> or stat/<device_id>/<type>)
    if let Some(tasmota_info) = parser::parse_tasmota_topic(topic) {
        if !device_state.is_accepted(&tasmota_info.device_id).await {
            info!(
                "Dropping Tasmota message from unconfigured device: {}",
                tasmota_info.device_id
            );
            return Ok(());
        }

        // Fallback measurement time; the parser prefers a payload clock.
        let timestamp = received_at;
        let signal_map = device_state.signal_map(&tasmota_info.device_id).await;

        let measurements = parser::parse_tasmota(&tasmota_info, payload, timestamp, signal_map.as_ref())?;
        let count = measurements.len();

        for m in &measurements {
            db::insert_measurement(pool, &tasmota_info.device_id, m.metric_id, m.value, m.time, received_at).await?;
            info!(
                "Inserted (Tasmota): device={}, metric={}, value={}",
                tasmota_info.device_id, m.metric_id, m.value
            );
        }

        if count > 0 {
            info!(
                "Processed {} Tasmota measurements from device {} ({})",
                count, tasmota_info.device_id, tasmota_info.message_type
            );

            let points: Vec<IngestedPoint> = measurements
                .iter()
                .map(|m| IngestedPoint { metric_id: m.metric_id, value: m.value, time: m.time })
                .collect();
            publisher.publish_batch(&tasmota_info.device_id, &points).await;
        }
        return Ok(());
    }

    // Route 3: Generic device (first topic segment = device_id, rest = source for signal_map)
    if let Some(generic_info) = parser::parse_generic_topic(topic) {
        if !device_state.is_accepted(&generic_info.device_id).await {
            info!(
                "Dropping generic message from unconfigured device: {}",
                generic_info.device_id
            );
            return Ok(());
        }

        // Fallback measurement time; the parser prefers a payload clock.
        let timestamp = received_at;
        let signal_map = device_state.signal_map(&generic_info.device_id).await;

        let measurements = parser::parse_generic(&generic_info, payload, timestamp, signal_map.as_ref())?;
        let count = measurements.len();

        for m in &measurements {
            db::insert_measurement(pool, &generic_info.device_id, m.metric_id, m.value, m.time, received_at).await?;
            info!(
                "Inserted (Generic): device={}, metric={}, value={}",
                generic_info.device_id, m.metric_id, m.value
            );
        }

        if count > 0 {
            info!(
                "Processed {} generic measurements from device {} (source={})",
                count, generic_info.device_id, generic_info.source
            );

            let points: Vec<IngestedPoint> = measurements
                .iter()
                .map(|m| IngestedPoint { metric_id: m.metric_id, value: m.value, time: m.time })
                .collect();
            publisher.publish_batch(&generic_info.device_id, &points).await;
        }
        return Ok(());
    }

    Err(anyhow!("Unsupported MQTT message format (topic={})", topic))
}
