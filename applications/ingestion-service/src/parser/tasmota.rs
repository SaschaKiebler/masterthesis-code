//! Tasmota device payload parsing
//!
//! Supports Tasmota devices publishing via MQTT with the standard topic layout:
//! - `tele/<device_id>/SENSOR` → sensor telemetry (e.g. `{"Gas":{"total":0.16}}`)
//! - `tele/<device_id>/STATE`  → device status (uptime, heap, wifi, etc.)
//! - `stat/<device_id>/RESULT` → command results
//!
//! Only `tele/.../SENSOR` messages carry measurement data; other message types
//! are received but currently not parsed into measurements.

use super::Measurement;
use super::shelly::extract_by_signal_map;
use anyhow::{anyhow, Result};
use chrono::{DateTime, Utc};
use tracing::debug;

/// Known Tasmota topic prefixes: telemetry and command results.
const TASMOTA_PREFIXES: &[&str] = &["tele/", "stat/"];

/// Result of parsing a Tasmota MQTT topic
#[derive(Debug, Clone)]
pub struct TasmotaTopicInfo {
    pub device_id: String,
    /// Message type, e.g. `SENSOR`, `STATE`, `RESULT`
    pub message_type: String,
}

/// Try to parse an MQTT topic as a Tasmota topic.
///
/// Matches `tele/<device_id>/<message_type>` and `stat/<device_id>/<message_type>`.
/// Returns None if the topic does not start with a known Tasmota prefix.
pub fn parse_tasmota_topic(topic: &str) -> Option<TasmotaTopicInfo> {
    let remainder = TASMOTA_PREFIXES
        .iter()
        .find(|p| topic.starts_with(**p))
        .map(|p| &topic[p.len()..])?;

    let slash_idx = remainder.find('/')?;
    let device_id = &remainder[..slash_idx];
    let message_type = &remainder[slash_idx + 1..];
    debug!("parse_tasmota_topic: remainder={}, slash_idx={}, device_id={}", remainder, slash_idx, device_id);

    if device_id.is_empty() || message_type.is_empty() {
        return None;
    }

    Some(TasmotaTopicInfo {
        device_id: device_id.to_string(),
        message_type: message_type.to_string(),
    })
}

/// Parse a Tasmota MQTT message into measurements using the signal_map.
pub fn parse_tasmota(
    topic_info: &TasmotaTopicInfo,
    payload: &str,
    timestamp: DateTime<Utc>,
    signal_map: Option<&serde_json::Value>,
) -> Result<Vec<Measurement>> {
    let json: serde_json::Value = serde_json::from_str(payload)
        .map_err(|e| anyhow!("Failed to parse Tasmota JSON: {}", e))?;

    // Tasmota stamps every tele/ message with a top-level `Time` field.
    let (measured_at, _from_device) = super::resolve_source_time(&json, timestamp);

    let measurements = extract_by_signal_map(&topic_info.message_type, &json, measured_at, signal_map);

    if measurements.is_empty() {
        return Err(anyhow!(
            "No signal_map entries matched message_type '{}' for device '{}'",
            topic_info.message_type, topic_info.device_id
        ));
    }

    debug!(
        "Tasmota: device={}, message_type={}, extracted {} measurements",
        topic_info.device_id, topic_info.message_type, measurements.len()
    );

    Ok(measurements)
}

#[cfg(test)]
#[path = "tasmota_tests.rs"]
mod tests;
