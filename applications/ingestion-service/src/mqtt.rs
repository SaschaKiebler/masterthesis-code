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

    let filters = subscription_filters(cfg);
    info!(
        client_id = %cfg.client_id,
        share_group = cfg.share_group.as_deref().unwrap_or("<none>"),
        "Connecting to MQTT broker"
    );
    subscribe_all(&client, &filters).await?;

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
                // the service connected but deaf to device traffic. For a
                // shared subscription it also re-enters the group, so the
                // broker resumes routing its share of the stream here.
                subscribe_all(&client, &filters).await?;
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

/// Subscribe to every effective filter, logging each one as it goes out.
async fn subscribe_all(client: &AsyncClient, filters: &[String]) -> Result<()> {
    for filter in filters {
        client.subscribe(filter, QoS::AtLeastOnce).await?;
        info!("Subscribed to MQTT filter: {}", filter);
    }
    Ok(())
}

/// The topic filters this instance actually subscribes to.
///
/// Two things happen here. Overlapping filters are collapsed, because the
/// broker delivers a message once per matching subscription: with the default
/// catch-all `#` in `extra_topics`, a `house/…` message also matched by the
/// primary filter would arrive twice and be inserted twice. Under a shared
/// subscription that would be worse than a duplicate row, since each filter
/// forms its own group and the two copies would land on two different pods.
///
/// Each surviving filter is then wrapped as `$share/<group>/<filter>` when a
/// share group is configured. The wrapping is a subscriber-side concern only:
/// publishers address plain topics, and the broker delivers the message under
/// its original topic name, so the parsers below never see the prefix.
fn subscription_filters(cfg: &MqttConfig) -> Vec<String> {
    let mut kept: Vec<&str> = Vec::new();

    for candidate in std::iter::once(cfg.topic.as_str())
        .chain(cfg.extra_topics.iter().map(String::as_str))
    {
        if candidate.is_empty() || kept.iter().any(|k| covers(k, candidate)) {
            continue;
        }
        // A broader filter arriving later replaces the narrower ones it subsumes.
        kept.retain(|k| !covers(candidate, k));
        kept.push(candidate);
    }

    kept.into_iter()
        .map(|filter| match &cfg.share_group {
            Some(group) => format!("$share/{group}/{filter}"),
            None => filter.to_string(),
        })
        .collect()
}

/// Does topic filter `outer` match every topic that `inner` matches?
fn covers(outer: &str, inner: &str) -> bool {
    // Wildcards never match topics starting with `$` (MQTT-4.7.2-1), so a
    // catch-all does not subsume a `$SYS/…` filter.
    if (outer.starts_with('#') || outer.starts_with('+')) && inner.starts_with('$') {
        return false;
    }

    let mut outer_segments = outer.split('/');
    let mut inner_segments = inner.split('/');

    loop {
        match (outer_segments.next(), inner_segments.next()) {
            // `#` covers this level and everything below it, `a/#` also `a`.
            (Some("#"), _) => return true,
            // `+` is exactly one level, so it cannot cover a multi-level `#`.
            (Some("+"), Some(inner_segment)) if inner_segment != "#" => continue,
            (Some(outer_segment), Some(inner_segment)) if outer_segment == inner_segment => continue,
            (None, None) => return true,
            _ => return false,
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

#[cfg(test)]
#[path = "mqtt_tests.rs"]
mod tests;
