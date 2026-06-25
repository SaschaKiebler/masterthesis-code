use super::*;
use chrono::Utc;

// ── Topic Parsing ──────────────────────────────────────────

#[test]
fn test_parse_tele_sensor() {
    let info = parse_tasmota_topic("tele/Gassensor_01_C3A3FA/SENSOR").unwrap();
    assert_eq!(info.device_id, "Gassensor_01_C3A3FA");
    assert_eq!(info.message_type, "SENSOR");
}

#[test]
fn test_parse_tele_state() {
    let info = parse_tasmota_topic("tele/Gassensor_02_B7A4B9/STATE").unwrap();
    assert_eq!(info.device_id, "Gassensor_02_B7A4B9");
    assert_eq!(info.message_type, "STATE");
}

#[test]
fn test_parse_stat_result() {
    let info = parse_tasmota_topic("stat/Gassensor_01_C3A3FA/RESULT").unwrap();
    assert_eq!(info.device_id, "Gassensor_01_C3A3FA");
    assert_eq!(info.message_type, "RESULT");
}

#[test]
fn test_non_tasmota_topic_returns_none() {
    assert!(parse_tasmota_topic("shellyplushi2t-AABB/status/temperature:0").is_none());
}

#[test]
fn test_no_slash_after_prefix_returns_none() {
    assert!(parse_tasmota_topic("tele/deviceonly").is_none());
}

#[test]
fn test_empty_device_returns_none() {
    assert!(parse_tasmota_topic("tele//SENSOR").is_none());
}

#[test]
fn test_empty_message_type_returns_none() {
    assert!(parse_tasmota_topic("tele/device/").is_none());
}

#[test]
fn test_unrelated_topic_returns_none() {
    assert!(parse_tasmota_topic("house/1/sensor/data").is_none());
}

// ── Payload Parsing ──────────────────────────────────────────

#[test]
fn test_parse_sensor_with_signal_map() {
    let ts = Utc::now();
    let info = TasmotaTopicInfo {
        device_id: "Gassensor_01_C3A3FA".to_string(),
        message_type: "SENSOR".to_string(),
    };
    let payload = r#"{"Time":"2026-04-24T18:03:44","Gas":{"total":0.24}}"#;
    let signal_map = serde_json::json!({
        "1": {"name": "Gas Total", "unit": "m³", "source": "SENSOR", "field": "Gas.total"}
    });

    let measurements = parse_tasmota(&info, payload, ts, Some(&signal_map)).unwrap();
    assert_eq!(measurements.len(), 1);
    assert_eq!(measurements[0].metric_id, 1);
    assert_eq!(measurements[0].value, 0.24);
}

#[test]
fn test_parse_sensor_no_signal_map_returns_error() {
    let ts = Utc::now();
    let info = TasmotaTopicInfo {
        device_id: "Gassensor_01_C3A3FA".to_string(),
        message_type: "SENSOR".to_string(),
    };
    let payload = r#"{"Time":"2026-04-24T18:03:44","Gas":{"total":0.24}}"#;

    let result = parse_tasmota(&info, payload, ts, None);
    assert!(result.is_err());
}

#[test]
fn test_parse_sensor_wrong_source_returns_error() {
    let ts = Utc::now();
    let info = TasmotaTopicInfo {
        device_id: "Gassensor_01_C3A3FA".to_string(),
        message_type: "SENSOR".to_string(),
    };
    let payload = r#"{"Gas":{"total":0.24}}"#;
    let signal_map = serde_json::json!({
        "1": {"name": "Gas Total", "source": "STATE", "field": "Gas.total"}
    });

    let result = parse_tasmota(&info, payload, ts, Some(&signal_map));
    assert!(result.is_err());
}

#[test]
fn test_parse_invalid_json_returns_error() {
    let ts = Utc::now();
    let info = TasmotaTopicInfo {
        device_id: "Gassensor_01_C3A3FA".to_string(),
        message_type: "SENSOR".to_string(),
    };

    let result = parse_tasmota(&info, "not json", ts, None);
    assert!(result.is_err());
}
