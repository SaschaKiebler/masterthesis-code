//! Generic device payload parsing
//!
//! Handles non-Shelly devices by extracting the device_id from the first MQTT
//! topic segment and using the signal_map for field-based extraction.
//!
//! Example: topic `Gassensor_01/data` with payload `{"gas":42,"temp":22.5}`
//!   → device_id = "Gassensor_01", source = "data"
//!   → signal_map entries with source="data" are used to extract fields

use super::Measurement;
use super::shelly::extract_by_signal_map;
use anyhow::{anyhow, Result};
use chrono::{DateTime, Utc};
use tracing::debug;

/// Result of parsing a generic MQTT topic into device_id and source
#[derive(Debug, Clone)]
pub struct GenericTopicInfo {
    pub device_id: String,
    pub source: String,
}

/// Try to parse an MQTT topic as a generic device topic.
///
/// Uses the first path segment as device_id and the remainder as source.
/// Returns None for topics without a `/` separator.
pub fn parse_generic_topic(topic: &str) -> Option<GenericTopicInfo> {
    let slash_idx = topic.find('/')?;
    let device_id = &topic[..slash_idx];
    let source = &topic[slash_idx + 1..];

    if device_id.is_empty() || source.is_empty() {
        return None;
    }

    Some(GenericTopicInfo {
        device_id: device_id.to_string(),
        source: source.to_string(),
    })
}

/// Parse a generic MQTT message into measurements using the signal_map.
pub fn parse_generic(
    topic_info: &GenericTopicInfo,
    payload: &str,
    timestamp: DateTime<Utc>,
    signal_map: Option<&serde_json::Value>,
) -> Result<Vec<Measurement>> {
    let json: serde_json::Value = serde_json::from_str(payload)
        .map_err(|e| anyhow!("Failed to parse generic device JSON: {}", e))?;

    // Gateway-published documents normally carry their own clock; this is the
    // route on which measurement time and receive time genuinely differ.
    let (measured_at, _from_device) = super::resolve_source_time(&json, timestamp);

    let measurements = extract_by_signal_map(&topic_info.source, &json, measured_at, signal_map);

    if measurements.is_empty() {
        return Err(anyhow!(
            "No signal_map entries matched source '{}' for device '{}'",
            topic_info.source, topic_info.device_id
        ));
    }

    debug!(
        "Generic: device={}, source={}, extracted {} measurements",
        topic_info.device_id, topic_info.source, measurements.len()
    );

    Ok(measurements)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    // ── Topic Parsing ──────────────────────────────────────────

    #[test]
    fn test_parse_simple_topic() {
        let info = parse_generic_topic("Gassensor_01/data").unwrap();
        assert_eq!(info.device_id, "Gassensor_01");
        assert_eq!(info.source, "data");
    }

    #[test]
    fn test_parse_nested_topic() {
        let info = parse_generic_topic("Gassensor_01/sensors/gas").unwrap();
        assert_eq!(info.device_id, "Gassensor_01");
        assert_eq!(info.source, "sensors/gas");
    }


    #[test]
    fn test_parse_no_slash_returns_none() {
        assert!(parse_generic_topic("just-a-device").is_none());
    }

    #[test]
    fn test_parse_empty_segments_returns_none() {
        assert!(parse_generic_topic("/data").is_none());
        assert!(parse_generic_topic("device/").is_none());
    }

    // ── Payload Parsing ──────────────────────────────────────────

    #[test]
    fn test_parse_generic_with_signal_map() {
        let ts = Utc::now();
        let info = GenericTopicInfo {
            device_id: "Gassensor_01".to_string(),
            source: "data".to_string(),
        };
        let payload = r#"{"gas_ppm": 42.0, "temperature": 22.5}"#;
        let signal_map = serde_json::json!({
            "1": {"name": "Gas", "unit": "ppm", "source": "data", "field": "gas_ppm"},
            "2": {"name": "Temperature", "unit": "celsius", "source": "data", "field": "temperature"}
        });

        let measurements = parse_generic(&info, payload, ts, Some(&signal_map)).unwrap();
        assert_eq!(measurements.len(), 2);

        let gas = measurements.iter().find(|m| m.metric_id == 1).unwrap();
        assert_eq!(gas.value, 42.0);
        let temp = measurements.iter().find(|m| m.metric_id == 2).unwrap();
        assert_eq!(temp.value, 22.5);
    }

    #[test]
    fn test_parse_generic_no_signal_map_returns_error() {
        let ts = Utc::now();
        let info = GenericTopicInfo {
            device_id: "Gassensor_01".to_string(),
            source: "data".to_string(),
        };
        let payload = r#"{"gas_ppm": 42.0}"#;

        let result = parse_generic(&info, payload, ts, None);
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_generic_wrong_source_returns_error() {
        let ts = Utc::now();
        let info = GenericTopicInfo {
            device_id: "Gassensor_01".to_string(),
            source: "data".to_string(),
        };
        let payload = r#"{"gas_ppm": 42.0}"#;
        let signal_map = serde_json::json!({
            "1": {"name": "Gas", "unit": "ppm", "source": "other_source", "field": "gas_ppm"}
        });

        let result = parse_generic(&info, payload, ts, Some(&signal_map));
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_generic_invalid_json_returns_error() {
        let ts = Utc::now();
        let info = GenericTopicInfo {
            device_id: "Gassensor_01".to_string(),
            source: "data".to_string(),
        };

        let result = parse_generic(&info, "not json", ts, None);
        assert!(result.is_err());
    }

    /// The boiler document the mock fleet publishes carries its own clock. The
    /// measurement must be stamped with that, not with the receive time —
    /// otherwise the evaluation cannot separate transport from processing.
    /// Timestamps are fixed rather than derived from `Utc::now()` so the clock
    /// skew guard behaves the same whenever the test runs.
    #[test]
    fn test_parse_generic_prefers_payload_clock() {
        let received = DateTime::parse_from_rfc3339("2026-08-10T12:00:05Z")
            .unwrap()
            .with_timezone(&Utc);
        let info = GenericTopicInfo {
            device_id: "mock-boiler-001".to_string(),
            source: "data".to_string(),
        };
        let payload =
            r#"{"flow_c":40.1,"return_c":23.1,"pump":true,"ts":"2026-08-10T12:00:00+00:00"}"#;
        let signal_map = serde_json::json!({
            "1": {"name": "Flow", "source": "data", "field": "flow_c"},
            "2": {"name": "Return", "source": "data", "field": "return_c"}
        });

        let measurements = parse_generic(&info, payload, received, Some(&signal_map)).unwrap();
        assert_eq!(measurements.len(), 2);
        for m in &measurements {
            assert_eq!(m.time.to_rfc3339(), "2026-08-10T12:00:00+00:00");
        }
    }

    /// A gateway that sends no clock still has to yield measurements, stamped
    /// with the receive time.
    #[test]
    fn test_parse_generic_falls_back_to_receive_time() {
        let received = DateTime::parse_from_rfc3339("2026-08-10T12:00:05Z")
            .unwrap()
            .with_timezone(&Utc);
        let info = GenericTopicInfo {
            device_id: "mock-boiler-001".to_string(),
            source: "data".to_string(),
        };
        let signal_map = serde_json::json!({
            "1": {"name": "Flow", "source": "data", "field": "flow_c"}
        });

        let measurements =
            parse_generic(&info, r#"{"flow_c":40.1}"#, received, Some(&signal_map)).unwrap();
        assert_eq!(measurements.len(), 1);
        assert_eq!(measurements[0].time, received);
    }

    #[test]
    fn test_parse_generic_dot_notation_field() {
        let ts = Utc::now();
        let info = GenericTopicInfo {
            device_id: "sensor_01".to_string(),
            source: "reading".to_string(),
        };
        let payload = r#"{"data": {"value": 99.5}}"#;
        let signal_map = serde_json::json!({
            "10": {"name": "Reading", "source": "reading", "field": "data.value"}
        });

        let measurements = parse_generic(&info, payload, ts, Some(&signal_map)).unwrap();
        assert_eq!(measurements.len(), 1);
        assert_eq!(measurements[0].value, 99.5);
    }
}
