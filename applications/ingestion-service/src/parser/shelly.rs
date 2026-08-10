//! Shelly sensor payload parsing
//!
//! Supports Gen2+ Shelly devices publishing via MQTT.
//!
//! ## Gen2+ Topics & Payloads
//! - `<device-id>/status/temperature:0` → `{"id":0,"tC":22.5,"tF":72.5}`
//! - `<device-id>/status/humidity:0` → `{"id":0,"rh":65.3}`
//! - `<device-id>/status/devicepower:0` → `{"id":0,"battery":{"V":3.04,"percent":87}}`
//! - `<device-id>/status/switch:0` → `{"id":0,"output":true,"apower":120.5,"voltage":230.1,...}`
//! - `<device-id>/status/em:0` → `{"id":0,"a_current":1.2,"a_voltage":230.5,"a_act_power":120.5,...,"total_act_power":420.9}`
//! - `<device-id>/status/emdata:0` → `{"id":0,"a_total_act_energy":12345.67,...,"total_act":39259.23}`

use super::{Measurement};
use anyhow::{anyhow, Error, Result};
use chrono::{DateTime, Utc};
use tracing::{debug, warn};

/// Result of parsing a Shelly MQTT topic into device_id and component info
#[derive(Debug, Clone)]
pub struct ShellyTopicInfo {
    pub device_id: String,
    pub component: String,
    pub generation: ShellyGeneration,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ShellyGeneration {
    Gen2,
}

/// Try to parse an MQTT topic as a Shelly topic.
/// Returns None if the topic does not match any known Shelly pattern.
pub fn parse_shelly_topic(topic: &str) -> Option<ShellyTopicInfo> {

    // Gen2+: <device-id>/status/<component>:<channel>
    // Also matches: <device-id>/events/rpc (skip these)
    if let Some(status_pos) = topic.find("/status/") {
        let device_id = topic[..status_pos].to_string();
        let component = topic[status_pos + 8..].to_string(); // after "/status/"

        return Some(ShellyTopicInfo {
            device_id,
            component,
            generation: ShellyGeneration::Gen2,
        })
    }
    None
}

/// Parse a Shelly MQTT message into measurements.
///
/// The topic determines the device_id and what kind of data is being sent.
/// The payload format depends on the Shelly generation (Gen2+).
///
/// When `signal_map` is provided (from `assets.signal_map`), channel-specific
/// metric_ids are resolved from it instead of using hardcoded defaults.
pub fn parse_shelly(
    topic_info: &ShellyTopicInfo,
    payload: &str,
    timestamp: DateTime<Utc>,
    signal_map: Option<&serde_json::Value>,
) -> Result<Vec<Measurement>> {
    match topic_info.generation {
        ShellyGeneration::Gen2 => parse_gen2(&topic_info.component, payload, timestamp, signal_map),
    }
}

/// Parse Gen2+ Shelly payload (JSON objects)
///
/// Uses a two-tier strategy (ADR-010):
/// 1. **Field-based extraction**: If the device's signal_map has entries with `source` matching
///    this component AND a `field` property, those declarative rules are used to extract values.
///    This is the data-driven path — no code changes needed for new sensor types.
/// 2. **Hardcoded fallback**: If no field-based entries matched, falls through to the built-in
///    component parsers (temperature, humidity, switch, em, emdata, etc.).
fn parse_gen2(
    component: &str,
    payload: &str,
    timestamp: DateTime<Utc>,
    signal_map: Option<&serde_json::Value>,
) -> Result<Vec<Measurement>> {
    let json: serde_json::Value = serde_json::from_str(payload)
        .map_err(|e| anyhow!("Failed to parse Shelly Gen2 JSON: {}", e))?;

    // Per-component status payloads carry no clock, so this resolves to the
    // receive time. Kept uniform with the other routes so a firmware that does
    // send one (Gen2 NotifyStatus) is picked up without a code change.
    let (measured_at, _from_device) = super::resolve_source_time(&json, timestamp);

    // ADR-010: Try data-driven field-based extraction first
    let field_based = extract_by_signal_map(component, &json, measured_at, signal_map);
    if !field_based.is_empty() {
        debug!(
            "Shelly Gen2: component={}, extracted {} measurements via signal_map fields",
            component,
            field_based.len()
        );
        return Ok(field_based);
    }


    Err(Error::msg("Failed to parse Shelly Gen2 JSON"))
}

/// Return the default JSON field for well-known Shelly component types.
///
/// When a signal_map entry matches by source but has no explicit `field`,
/// this provides sensible defaults so common sensors work out of the box.
fn default_field_for_component(component: &str) -> Option<&'static str> {
    let component_type = component.split(':').next().unwrap_or(component);
    match component_type {
        "temperature" => Some("tC"),
        "humidity" => Some("rh"),
        _ => None,
    }
}

/// Attempt data-driven extraction using field-level signal_map entries (ADR-010).
///
/// For each signal_map entry whose `source` matches the incoming `component` and
/// has a `field` property, extracts the value at that JSON field path from the payload.
/// Supports dot-notation for nested fields (e.g., `"aenergy.total"`).
///
/// When a matching entry has no `field` set, falls back to well-known defaults
/// for common Shelly component types (e.g., `tC` for temperature).
///
/// Returns the extracted measurements. If no field-based entries match, returns an
/// empty vec — the caller should fall through to hardcoded parsing.
pub(crate) fn extract_by_signal_map(
    component: &str,
    json: &serde_json::Value,
    timestamp: DateTime<Utc>,
    signal_map: Option<&serde_json::Value>,
) -> Vec<Measurement> {
    let map = match signal_map.and_then(|v| v.as_object()) {
        Some(m) if !m.is_empty() => m,
        _ => return vec![],
    };

    let mut measurements = Vec::new();

    // Normalize component to include channel (e.g., "em" → "em:0" if no channel present)
    let source_key = if component.contains(':') {
        component.to_string()
    } else {
        format!("{}:0", component)
    };

    for (key, entry) in map {
        // Entry must have `source` matching this component
        let entry_source = match entry.get("source").and_then(|s| s.as_str()) {
            Some(s) => s,
            None => continue,
        };

        // Match against both the raw component and the normalized form
        if entry_source != component && entry_source != source_key {
            continue;
        }

        // Use explicit field, or fall back to well-known default for the component type
        let field_path = match entry.get("field").and_then(|f| f.as_str()).filter(|f| !f.is_empty()) {
            Some(f) => f,
            None => match default_field_for_component(component) {
                Some(default) => {
                    debug!(
                        "extract_by_signal_map: source={} has no field, using default '{}' for component type",
                        entry_source, default
                    );
                    default
                }
                None => continue,
            },
        };

        let metric_id = match key.parse::<i16>() {
            Ok(id) => id,
            Err(_) => continue,
        };

        if let Some(value) = resolve_json_field(json, field_path) {
            debug!(
                "extract_by_signal_map: source={}, field={} → metric_id={}, value={}",
                entry_source, field_path, metric_id, value
            );
            measurements.push(Measurement {
                metric_id,
                value,
                time: timestamp,
            });
        } else {
            debug!(
                "extract_by_signal_map: source={}, field={} → value not found or null, skipping",
                entry_source, field_path
            );
        }
    }

    measurements
}

/// Resolve a potentially nested JSON field path using dot-notation.
///
/// Examples:
/// - `"a_act_power"` → `json["a_act_power"]`
/// - `"aenergy.total"` → `json["aenergy"]["total"]`
/// - `"battery.percent"` → `json["battery"]["percent"]`
///
/// Returns `None` if any segment is missing or the final value is not a number.
/// Maximum traversal depth: 3 levels.
pub(crate) fn resolve_json_field(json: &serde_json::Value, field_path: &str) -> Option<f64> {
    let segments: Vec<&str> = field_path.split('.').collect();

    if segments.len() > 3 {
        warn!(
            "resolve_json_field: field path '{}' exceeds max depth of 3",
            field_path
        );
        return None;
    }

    let mut current = json;
    for segment in &segments {
        current = current.get(*segment)?;
    }

    // Try numeric first, then boolean (true → 1.0, false → 0.0)
    current
        .as_f64()
        .or_else(|| current.as_bool().map(|b| if b { 1.0 } else { 0.0 }))
}

#[cfg(test)]
#[path = "shelly_tests.rs"]
mod tests;
