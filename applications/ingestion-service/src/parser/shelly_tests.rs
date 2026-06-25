use super::*;
use chrono::Utc;

// ── Topic Parsing ──────────────────────────────────────────────


#[test]
fn test_parse_gen2_temperature_topic() {
    let info =
        parse_shelly_topic("shellyplushi&t-AABBCCDDEEFF/status/temperature:0").unwrap();
    assert_eq!(info.device_id, "shellyplushi&t-AABBCCDDEEFF");
    assert_eq!(info.component, "temperature:0");
    assert_eq!(info.generation, ShellyGeneration::Gen2);
}

#[test]
fn test_parse_gen2_humidity_topic() {
    let info = parse_shelly_topic("shellyplushi&t-AABBCCDDEEFF/status/humidity:0").unwrap();
    assert_eq!(info.device_id, "shellyplushi&t-AABBCCDDEEFF");
    assert_eq!(info.component, "humidity:0");
    assert_eq!(info.generation, ShellyGeneration::Gen2);
}

#[test]
fn test_parse_gen2_devicepower_topic() {
    let info =
        parse_shelly_topic("shellyplushi&t-AABBCCDDEEFF/status/devicepower:0").unwrap();
    assert_eq!(info.device_id, "shellyplushi&t-AABBCCDDEEFF");
    assert_eq!(info.component, "devicepower:0");
    assert_eq!(info.generation, ShellyGeneration::Gen2);
}

#[test]
fn test_parse_gen2_switch_topic() {
    let info = parse_shelly_topic("shellyplus1-AABBCCDDEEFF/status/switch:0").unwrap();
    assert_eq!(info.device_id, "shellyplus1-AABBCCDDEEFF");
    assert_eq!(info.component, "switch:0");
    assert_eq!(info.generation, ShellyGeneration::Gen2);
}

#[test]
fn test_non_shelly_topic_returns_none() {
    assert!(parse_shelly_topic("house/1/sensor/temp").is_none());
    assert!(parse_shelly_topic("random/topic").is_none());
}

#[test]
fn test_status_topic_matches_any_device_id() {
    // Any topic with /status/ is treated as Shelly Gen2+ format —
    // the asset registry gate handles filtering non-Shelly devices
    let info = parse_shelly_topic("mydevice-123/status/temperature:0").unwrap();
    assert_eq!(info.device_id, "mydevice-123");
    assert_eq!(info.component, "temperature:0");
}

// ── Gen2 Payload Parsing ───────────────────────────────────────

#[test]
fn test_gen2_unknown_component() {
    let ts = Utc::now();
    let payload = r#"{"id":0,"some_field":42}"#;
    let result = parse_gen2("unknown:0", payload, ts, None);
    assert!(result.is_err());
}

#[test]
fn test_gen2_invalid_json() {
    let ts = Utc::now();
    let result = parse_gen2("temperature:0", "not json", ts, None);
    assert!(result.is_err());
}

// ── Integration: parse_shelly ──────────────────────────────────

#[test]
fn test_parse_shelly_gen2_end_to_end() {
    let ts = Utc::now();
    let info =
        parse_shelly_topic("shellyplushi&t-AABBCCDDEEFF/status/temperature:0").unwrap();
    let payload = r#"{"id":0,"tC":19.8,"tF":67.6}"#;
    let signal_map = serde_json::json!({
        "10": {"name": "Temperature", "unit": "celsius", "source": "temperature:0", "field": "tC"}
    });
    let measurements = parse_shelly(&info, payload, ts, Some(&signal_map)).unwrap();
    assert_eq!(measurements.len(), 1);
    assert_eq!(measurements[0].value, 19.8);
}

#[test]
fn test_gen2_shelly_plus_uni_high_channels_with_signal_map() {
    let ts = Utc::now();
    let signal_map = serde_json::json!({
        "100": {"name": "temp 3", "source": "temperature:100", "field": "tC"},
        "101": {"max": 50, "min": 0, "name": "Vorlauf 1", "unit": "celsius", "source": "temperature:101", "field": "tC"},
        "102": {"max": 50, "min": -10, "name": "temp", "unit": "celsius", "source": "temperature:102", "field": "tC"},
        "103": {"name": "temp 2", "unit": "celsius", "source": "temperature:103", "field": "tC"}
    });

    let payload = r#"{"id":100,"tC":23.1,"tF":73.6}"#;
    let m100 = parse_gen2("temperature:100", payload, ts, Some(&signal_map)).unwrap();
    assert_eq!(m100[0].metric_id, 100);
    assert_eq!(m100[0].value, 23.1);

    let payload = r#"{"id":102,"tC":23.8,"tF":74.8}"#;
    let m102 = parse_gen2("temperature:102", payload, ts, Some(&signal_map)).unwrap();
    assert_eq!(m102[0].metric_id, 102);

    let payload = r#"{"id":103,"tC":23.4,"tF":74.1}"#;
    let m103 = parse_gen2("temperature:103", payload, ts, Some(&signal_map)).unwrap();
    assert_eq!(m103[0].metric_id, 103);
}

// ── Gen2 + signal_map integration ─────────────────────────────

#[test]
fn test_gen2_temperature_with_signal_map_multi_channel() {
    let ts = Utc::now();
    let signal_map = serde_json::json!({
        "100": {"name": "temp 3", "source": "temperature:0", "field": "tC"},
        "101": {"max": 50, "min": 0, "name": "Vorlauf 1", "unit": "celsius", "source": "temperature:1", "field": "tC"},
        "102": {"max": 50, "min": -10, "name": "temp", "unit": "celsius", "source": "temperature:2", "field": "tC"},
        "103": {"name": "temp 2", "unit": "celsius", "source": "temperature:3", "field": "tC"}
    });

    let payload = r#"{"id":0,"tC":22.5,"tF":72.5}"#;
    let m0 = parse_gen2("temperature:0", payload, ts, Some(&signal_map)).unwrap();
    assert_eq!(m0[0].metric_id, 100);

    let m1 = parse_gen2("temperature:1", payload, ts, Some(&signal_map)).unwrap();
    assert_eq!(m1[0].metric_id, 101);

    let m2 = parse_gen2("temperature:2", payload, ts, Some(&signal_map)).unwrap();
    assert_eq!(m2[0].metric_id, 102);

    let m3 = parse_gen2("temperature:3", payload, ts, Some(&signal_map)).unwrap();
    assert_eq!(m3[0].metric_id, 103);
}

#[test]
fn test_gen2_temperature_without_signal_map_returns_error() {
    let ts = Utc::now();
    let payload = r#"{"id":0,"tC":22.5,"tF":72.5}"#;
    let result = parse_gen2("temperature:2", payload, ts, None);
    assert!(result.is_err());
}

#[test]
fn test_parse_shelly_gen2_with_signal_map_end_to_end() {
    let ts = Utc::now();
    let signal_map = serde_json::json!({
        "100": {"name": "temp 3", "source": "temperature:0", "field": "tC"},
        "101": {"name": "Vorlauf 1", "unit": "celsius", "source": "temperature:1", "field": "tC"},
        "102": {"name": "temp", "unit": "celsius", "source": "temperature:2", "field": "tC"},
        "103": {"name": "temp 2", "unit": "celsius", "source": "temperature:3", "field": "tC"}
    });
    let info =
        parse_shelly_topic("shellyplushi&t-AABBCCDDEEFF/status/temperature:2").unwrap();
    let payload = r#"{"id":2,"tC":35.1,"tF":95.2}"#;
    let measurements = parse_shelly(&info, payload, ts, Some(&signal_map)).unwrap();
    assert_eq!(measurements.len(), 1);
    assert_eq!(measurements[0].metric_id, 102);
    assert_eq!(measurements[0].value, 35.1);
}

// ── ADR-010: Field-based signal_map extraction ───────────────

#[test]
fn test_extract_by_signal_map_flat_fields() {
    let ts = Utc::now();
    let json: serde_json::Value = serde_json::from_str(r#"{
        "a_act_power": 120.5,
        "a_voltage": 230.1,
        "total_act_power": 420.9
    }"#).unwrap();
    let signal_map = serde_json::json!({
        "20": {"name": "Phase A Power", "unit": "watt", "source": "em:0", "field": "a_act_power"},
        "23": {"name": "Phase A Voltage", "unit": "volt", "source": "em:0", "field": "a_voltage"},
        "4":  {"name": "Total Power", "unit": "watt", "source": "em:0", "field": "total_act_power"}
    });

    let measurements = extract_by_signal_map("em:0", &json, ts, Some(&signal_map));
    assert_eq!(measurements.len(), 3);

    let power_a = measurements.iter().find(|m| m.metric_id == 20).unwrap();
    assert_eq!(power_a.value, 120.5);
    let voltage_a = measurements.iter().find(|m| m.metric_id == 23).unwrap();
    assert_eq!(voltage_a.value, 230.1);
    let total = measurements.iter().find(|m| m.metric_id == 4).unwrap();
    assert_eq!(total.value, 420.9);
}

#[test]
fn test_extract_by_signal_map_dot_notation() {
    let ts = Utc::now();
    let json: serde_json::Value = serde_json::from_str(r#"{
        "apower": 120.5,
        "voltage": 230.1,
        "aenergy": {"total": 1234.5}
    }"#).unwrap();
    let signal_map = serde_json::json!({
        "4":  {"name": "Power", "unit": "watt", "source": "switch:0", "field": "apower"},
        "14": {"name": "Voltage", "unit": "volt", "source": "switch:0", "field": "voltage"},
        "5":  {"name": "Energy", "unit": "watt_hour", "source": "switch:0", "field": "aenergy.total"}
    });

    let measurements = extract_by_signal_map("switch:0", &json, ts, Some(&signal_map));
    assert_eq!(measurements.len(), 3);

    let energy = measurements.iter().find(|m| m.metric_id == 5).unwrap();
    assert_eq!(energy.value, 1234.5);
}

#[test]
fn test_extract_by_signal_map_null_field_skipped() {
    let ts = Utc::now();
    let json: serde_json::Value = serde_json::from_str(r#"{
        "a_act_power": 120.5,
        "b_act_power": null
    }"#).unwrap();
    let signal_map = serde_json::json!({
        "20": {"name": "Phase A Power", "source": "em:0", "field": "a_act_power"},
        "21": {"name": "Phase B Power", "source": "em:0", "field": "b_act_power"}
    });

    let measurements = extract_by_signal_map("em:0", &json, ts, Some(&signal_map));
    assert_eq!(measurements.len(), 1);
    assert_eq!(measurements[0].metric_id, 20);
}

#[test]
fn test_extract_by_signal_map_missing_field_skipped() {
    let ts = Utc::now();
    let json: serde_json::Value = serde_json::from_str(r#"{
        "a_act_power": 120.5
    }"#).unwrap();
    let signal_map = serde_json::json!({
        "20": {"name": "Phase A Power", "source": "em:0", "field": "a_act_power"},
        "21": {"name": "Phase B Power", "source": "em:0", "field": "b_act_power"}
    });

    let measurements = extract_by_signal_map("em:0", &json, ts, Some(&signal_map));
    assert_eq!(measurements.len(), 1);
    assert_eq!(measurements[0].metric_id, 20);
}

#[test]
fn test_extract_by_signal_map_no_field_entries_uses_default_for_temperature() {
    let ts = Utc::now();
    let json: serde_json::Value = serde_json::from_str(r#"{"tC": 22.5}"#).unwrap();
    // signal_map has source but no field → auto-infers tC for temperature
    let signal_map = serde_json::json!({
        "100": {"name": "Temperature", "unit": "celsius", "source": "temperature:0"}
    });

    let measurements = extract_by_signal_map("temperature:0", &json, ts, Some(&signal_map));
    assert_eq!(measurements.len(), 1);
    assert_eq!(measurements[0].metric_id, 100);
    assert_eq!(measurements[0].value, 22.5);
}

#[test]
fn test_extract_by_signal_map_no_field_unknown_component_returns_empty() {
    let ts = Utc::now();
    let json: serde_json::Value = serde_json::from_str(r#"{"some_val": 42.0}"#).unwrap();
    // signal_map has source but no field for unknown component → empty
    let signal_map = serde_json::json!({
        "100": {"name": "Custom", "source": "custom:0"}
    });

    let measurements = extract_by_signal_map("custom:0", &json, ts, Some(&signal_map));
    assert_eq!(measurements.len(), 0);
}

#[test]
fn test_extract_by_signal_map_no_signal_map_returns_empty() {
    let ts = Utc::now();
    let json: serde_json::Value = serde_json::from_str(r#"{"a_act_power": 120.5}"#).unwrap();
    let measurements = extract_by_signal_map("em:0", &json, ts, None);
    assert_eq!(measurements.len(), 0);
}

#[test]
fn test_extract_by_signal_map_wrong_source_ignored() {
    let ts = Utc::now();
    let json: serde_json::Value = serde_json::from_str(r#"{"a_act_power": 120.5}"#).unwrap();
    let signal_map = serde_json::json!({
        "20": {"name": "Power", "source": "emdata:0", "field": "a_act_power"}
    });

    // Component is em:0 but signal_map entry targets emdata:0
    let measurements = extract_by_signal_map("em:0", &json, ts, Some(&signal_map));
    assert_eq!(measurements.len(), 0);
}

#[test]
fn test_extract_by_signal_map_component_without_channel_normalizes() {
    let ts = Utc::now();
    let json: serde_json::Value = serde_json::from_str(r#"{"tC": 22.5}"#).unwrap();
    let signal_map = serde_json::json!({
        "100": {"name": "Temp", "source": "temperature:0", "field": "tC"}
    });

    // Component "temperature" (no :0) should still match source "temperature:0"
    let measurements = extract_by_signal_map("temperature", &json, ts, Some(&signal_map));
    assert_eq!(measurements.len(), 1);
    assert_eq!(measurements[0].metric_id, 100);
    assert_eq!(measurements[0].value, 22.5);
}

#[test]
fn test_extract_by_signal_map_multiple_sources_only_matching() {
    let ts = Utc::now();
    let json: serde_json::Value = serde_json::from_str(r#"{
        "a_act_power": 120.5,
        "total_act_power": 420.9
    }"#).unwrap();
    let signal_map = serde_json::json!({
        "20": {"name": "Phase A Power", "source": "em:0", "field": "a_act_power"},
        "4":  {"name": "Total Power", "source": "em:0", "field": "total_act_power"},
        "5":  {"name": "Total Energy", "source": "emdata:0", "field": "total_act"},
        "30": {"name": "Phase A Energy", "source": "emdata:0", "field": "a_total_act_energy"}
    });

    let measurements = extract_by_signal_map("em:0", &json, ts, Some(&signal_map));
    // Only em:0 entries should match, not emdata:0
    assert_eq!(measurements.len(), 2);
    assert!(measurements.iter().any(|m| m.metric_id == 20));
    assert!(measurements.iter().any(|m| m.metric_id == 4));
}

#[test]
fn test_resolve_json_field_flat() {
    let json: serde_json::Value = serde_json::from_str(r#"{"a_act_power": 120.5}"#).unwrap();
    assert_eq!(resolve_json_field(&json, "a_act_power"), Some(120.5));
}

#[test]
fn test_resolve_json_field_nested() {
    let json: serde_json::Value = serde_json::from_str(r#"{"aenergy": {"total": 1234.5}}"#).unwrap();
    assert_eq!(resolve_json_field(&json, "aenergy.total"), Some(1234.5));
}

#[test]
fn test_resolve_json_field_deeply_nested() {
    let json: serde_json::Value = serde_json::from_str(r#"{"a": {"b": {"c": 42.0}}}"#).unwrap();
    assert_eq!(resolve_json_field(&json, "a.b.c"), Some(42.0));
}

#[test]
fn test_resolve_json_field_too_deep_returns_none() {
    let json: serde_json::Value = serde_json::from_str(r#"{"a": {"b": {"c": {"d": 1.0}}}}"#).unwrap();
    assert_eq!(resolve_json_field(&json, "a.b.c.d"), None);
}

#[test]
fn test_resolve_json_field_missing_returns_none() {
    let json: serde_json::Value = serde_json::from_str(r#"{"a_act_power": 120.5}"#).unwrap();
    assert_eq!(resolve_json_field(&json, "nonexistent"), None);
}

#[test]
fn test_resolve_json_field_null_returns_none() {
    let json: serde_json::Value = serde_json::from_str(r#"{"a_act_power": null}"#).unwrap();
    assert_eq!(resolve_json_field(&json, "a_act_power"), None);
}

// ── ADR-010: parse_gen2 integration with field-based extraction ──

#[test]
fn test_gen2_field_based_extraction_takes_priority() {
    let ts = Utc::now();
    let payload = r#"{"id":0,"tC":22.5,"tF":72.5}"#;
    // signal_map with field-based entry for temperature:0
    let signal_map = serde_json::json!({
        "200": {"name": "Custom Temp", "unit": "celsius", "source": "temperature:0", "field": "tC"}
    });

    let measurements = parse_gen2("temperature:0", payload, ts, Some(&signal_map)).unwrap();
    assert_eq!(measurements.len(), 1);
    // Should use field-based extraction (metric_id 200), NOT hardcoded (metric_id 10)
    assert_eq!(measurements[0].metric_id, 200);
    assert_eq!(measurements[0].value, 22.5);
}

#[test]
fn test_gen2_field_based_em_via_signal_map() {
    let ts = Utc::now();
    let payload = r#"{
        "id": 0,
        "a_act_power": 120.5,
        "a_voltage": 230.1,
        "total_act_power": 420.9,
        "a_freq": 50.0
    }"#;
    let signal_map = serde_json::json!({
        "20": {"name": "Phase A Power", "unit": "watt", "source": "em:0", "field": "a_act_power"},
        "23": {"name": "Phase A Voltage", "unit": "volt", "source": "em:0", "field": "a_voltage"},
        "4":  {"name": "Total Power", "unit": "watt", "source": "em:0", "field": "total_act_power"},
        "16": {"name": "Frequency", "unit": "hertz", "source": "em:0", "field": "a_freq"}
    });

    let measurements = parse_gen2("em:0", payload, ts, Some(&signal_map)).unwrap();
    assert_eq!(measurements.len(), 4);

    let power_a = measurements.iter().find(|m| m.metric_id == 20).unwrap();
    assert_eq!(power_a.value, 120.5);
    let freq = measurements.iter().find(|m| m.metric_id == 16).unwrap();
    assert_eq!(freq.value, 50.0);
}

#[test]
fn test_gen2_no_field_entries_uses_default_for_temperature() {
    let ts = Utc::now();
    let payload = r#"{"id":0,"tC":22.5,"tF":72.5}"#;
    // signal_map with source but NO field → auto-infers tC for temperature
    let signal_map = serde_json::json!({
        "100": {"name": "Custom Temp", "unit": "celsius", "source": "temperature:0"}
    });

    let result = parse_gen2("temperature:0", payload, ts, Some(&signal_map)).unwrap();
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].metric_id, 100);
    assert_eq!(result[0].value, 22.5);
}

#[test]
fn test_gen2_no_field_entries_unknown_component_returns_error() {
    let ts = Utc::now();
    let payload = r#"{"id":0,"some_field":42}"#;
    // signal_map with source but NO field for unknown component → error
    let signal_map = serde_json::json!({
        "100": {"name": "Custom", "source": "custom:0"}
    });

    let result = parse_gen2("custom:0", payload, ts, Some(&signal_map));
    assert!(result.is_err());
}

#[test]
fn test_gen2_mixed_mode_em_and_temp_field_based() {
    let ts = Utc::now();
    let signal_map = serde_json::json!({
        "20": {"name": "Phase A Power", "unit": "watt", "source": "em:0", "field": "a_act_power"},
        "100": {"name": "Vorlauf", "unit": "celsius", "source": "temperature:0", "field": "tC"}
    });

    // em:0 → field-based extraction
    let em_payload = r#"{"id":0,"a_act_power":120.5}"#;
    let em_measurements = parse_gen2("em:0", em_payload, ts, Some(&signal_map)).unwrap();
    assert_eq!(em_measurements.len(), 1);
    assert_eq!(em_measurements[0].metric_id, 20);

    // temperature:0 → also field-based now
    let temp_payload = r#"{"id":0,"tC":22.5,"tF":72.5}"#;
    let temp_measurements = parse_gen2("temperature:0", temp_payload, ts, Some(&signal_map)).unwrap();
    assert_eq!(temp_measurements.len(), 1);
    assert_eq!(temp_measurements[0].metric_id, 100);
}

#[test]
fn test_gen2_field_based_switch_dot_notation() {
    let ts = Utc::now();
    let payload = r#"{"id":0,"output":true,"apower":120.5,"voltage":230.1,"aenergy":{"total":1234.5}}"#;
    let signal_map = serde_json::json!({
        "40": {"name": "Power", "unit": "watt", "source": "switch:0", "field": "apower"},
        "41": {"name": "Voltage", "unit": "volt", "source": "switch:0", "field": "voltage"},
        "42": {"name": "Energy", "unit": "watt_hour", "source": "switch:0", "field": "aenergy.total"}
    });

    let measurements = parse_gen2("switch:0", payload, ts, Some(&signal_map)).unwrap();
    assert_eq!(measurements.len(), 3);

    let energy = measurements.iter().find(|m| m.metric_id == 42).unwrap();
    assert_eq!(energy.value, 1234.5);
}

#[test]
fn test_gen2_field_based_unknown_component_works() {
    let ts = Utc::now();
    // A totally unknown component that has no hardcoded parser
    let payload = r#"{"id":0,"temperature":55.2,"pressure":1013.25}"#;
    let signal_map = serde_json::json!({
        "50": {"name": "Boiler Temp", "unit": "celsius", "source": "custom_sensor:0", "field": "temperature"},
        "51": {"name": "Pressure", "unit": "hpa", "source": "custom_sensor:0", "field": "pressure"}
    });

    let measurements = parse_gen2("custom_sensor:0", payload, ts, Some(&signal_map)).unwrap();
    assert_eq!(measurements.len(), 2);

    let temp = measurements.iter().find(|m| m.metric_id == 50).unwrap();
    assert_eq!(temp.value, 55.2);
    let pressure = measurements.iter().find(|m| m.metric_id == 51).unwrap();
    assert_eq!(pressure.value, 1013.25);
}

#[test]
fn test_gen2_field_based_devicepower_nested() {
    let ts = Utc::now();
    let payload = r#"{"id":0,"battery":{"V":3.04,"percent":87}}"#;
    let signal_map = serde_json::json!({
        "13": {"name": "Battery", "unit": "percent", "source": "devicepower:0", "field": "battery.percent"},
        "14": {"name": "Voltage", "unit": "volt", "source": "devicepower:0", "field": "battery.V"}
    });

    let measurements = parse_gen2("devicepower:0", payload, ts, Some(&signal_map)).unwrap();
    assert_eq!(measurements.len(), 2);

    let battery = measurements.iter().find(|m| m.metric_id == 13).unwrap();
    assert_eq!(battery.value, 87.0);
    let voltage = measurements.iter().find(|m| m.metric_id == 14).unwrap();
    assert_eq!(voltage.value, 3.04);
}

#[test]
fn test_parse_shelly_field_based_end_to_end() {
    let ts = Utc::now();
    let info = parse_shelly_topic("shellypro3em-AABBCCDDEEFF/status/em:0").unwrap();
    let payload = r#"{
        "id": 0,
        "a_act_power": 345.0,
        "a_voltage": 230.5,
        "total_act_power": 345.0
    }"#;
    let signal_map = serde_json::json!({
        "20": {"name": "Phase A Power", "unit": "watt", "source": "em:0", "field": "a_act_power"},
        "23": {"name": "Phase A Voltage", "unit": "volt", "source": "em:0", "field": "a_voltage"},
        "4":  {"name": "Total Power", "unit": "watt", "source": "em:0", "field": "total_act_power"}
    });

    let measurements = parse_shelly(&info, payload, ts, Some(&signal_map)).unwrap();
    assert_eq!(measurements.len(), 3);

    let total = measurements.iter().find(|m| m.metric_id == 4).unwrap();
    assert_eq!(total.value, 345.0);
}