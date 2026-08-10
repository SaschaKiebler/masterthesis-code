//! Payload parsing and decryption
//!
//! Protocol-specific parsers are organized into submodules.

pub mod generic;
pub mod shelly;
pub mod tasmota;

use chrono::{DateTime, NaiveDateTime, Utc};
use tracing::warn;

pub use self::generic::{parse_generic, parse_generic_topic};
pub use self::shelly::{parse_shelly, parse_shelly_topic};
pub use self::tasmota::{parse_tasmota, parse_tasmota_topic};



/// A parsed measurement ready for insertion
#[derive(Debug, Clone)]
pub struct Measurement {
    pub metric_id: i16,
    pub value: f64,
    pub time: DateTime<Utc>,
}

/// Top-level payload fields a device or gateway may use to carry its own clock,
/// checked in this order. `Time` is Tasmota's field name, `ts` and `timestamp`
/// are the usual gateway conventions.
const SOURCE_TIME_FIELDS: &[&str] = &["ts", "timestamp", "Time", "time"];

/// How far a payload clock may sit from the receive time before it is rejected.
/// A device that boots without NTP reports epoch 0; taking that at face value
/// would open a hypertable chunk in 1970 and quietly distort every time-range
/// query against the store.
const MAX_CLOCK_SKEW_SECONDS: i64 = 24 * 3600;

/// Resolve the measurement timestamp a payload carries, falling back to the
/// receive time when it carries none or an unusable one.
///
/// Returns the resolved time and whether it actually came from the payload, so
/// callers can tell a device clock from a platform clock. Shelly's
/// per-component status payloads have no timestamp field on real hardware and
/// therefore always fall back — a property of the wire format, not a defect.
pub(crate) fn resolve_source_time(
    json: &serde_json::Value,
    received_at: DateTime<Utc>,
) -> (DateTime<Utc>, bool) {
    for field in SOURCE_TIME_FIELDS {
        let Some(raw) = json.get(*field) else { continue };

        let Some(parsed) = parse_source_time(raw) else {
            warn!("Payload field '{}' is not a usable timestamp, using receive time", field);
            continue;
        };

        let skew = (parsed - received_at).num_seconds().abs();
        if skew > MAX_CLOCK_SKEW_SECONDS {
            warn!(
                "Payload clock in field '{}' is {} s off the receive time (limit {} s), using receive time",
                field, skew, MAX_CLOCK_SKEW_SECONDS
            );
            continue;
        }

        return (parsed, true);
    }

    (received_at, false)
}

/// Read one JSON value as a timestamp.
///
/// Accepts RFC 3339 strings, the offset-less `YYYY-MM-DDTHH:MM:SS` form Tasmota
/// emits (read as UTC), and numeric epochs in either seconds or milliseconds.
fn parse_source_time(raw: &serde_json::Value) -> Option<DateTime<Utc>> {
    if let Some(text) = raw.as_str() {
        if let Ok(dt) = DateTime::parse_from_rfc3339(text) {
            return Some(dt.with_timezone(&Utc));
        }
        return NaiveDateTime::parse_from_str(text, "%Y-%m-%dT%H:%M:%S")
            .ok()
            .map(|naive| naive.and_utc());
    }

    let epoch = raw.as_f64()?;
    if !epoch.is_finite() {
        return None;
    }

    // Epoch milliseconds are three orders of magnitude larger than epoch
    // seconds, and 1e11 seconds is the year 5138, so anything above that
    // threshold can only be milliseconds.
    let seconds = if epoch.abs() >= 1e11 { epoch / 1000.0 } else { epoch };

    // floor keeps the remainder in [0, 1) for negative epochs as well.
    let whole = seconds.floor();
    let nanos = ((seconds - whole) * 1e9).round() as u32;
    DateTime::from_timestamp(whole as i64, nanos.min(999_999_999))
}

#[cfg(test)]
mod source_time_tests {
    use super::*;
    use serde_json::json;

    /// Receive time used as the fallback in every case below.
    fn received() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-08-10T12:00:10Z")
            .unwrap()
            .with_timezone(&Utc)
    }

    fn expect_device_clock(payload: serde_json::Value, expected_rfc3339: &str) {
        let (time, from_device) = resolve_source_time(&payload, received());
        assert!(from_device, "expected the payload clock to be used");
        assert_eq!(time.to_rfc3339(), expected_rfc3339);
    }

    #[test]
    fn rfc3339_string_is_used() {
        expect_device_clock(
            json!({"ts": "2026-08-10T12:00:00+00:00", "flow_c": 55.0}),
            "2026-08-10T12:00:00+00:00",
        );
    }

    #[test]
    fn rfc3339_with_offset_is_normalised_to_utc() {
        expect_device_clock(
            json!({"ts": "2026-08-10T14:00:00+02:00"}),
            "2026-08-10T12:00:00+00:00",
        );
    }

    #[test]
    fn tasmota_offsetless_time_is_read_as_utc() {
        expect_device_clock(
            json!({"Time": "2026-08-10T12:00:00", "ENERGY": {"Total": 1.5}}),
            "2026-08-10T12:00:00+00:00",
        );
    }

    #[test]
    fn epoch_seconds_are_accepted() {
        let epoch = received().timestamp() - 3;
        expect_device_clock(json!({"ts": epoch}), "2026-08-10T12:00:07+00:00");
    }

    #[test]
    fn epoch_milliseconds_are_accepted() {
        let epoch_ms = received().timestamp_millis() - 2500;
        expect_device_clock(json!({"ts": epoch_ms}), "2026-08-10T12:00:07.500+00:00");
    }

    #[test]
    fn shelly_status_payload_falls_back_to_receive_time() {
        let (time, from_device) =
            resolve_source_time(&json!({"id": 0, "tC": 22.5, "tF": 72.5}), received());
        assert!(!from_device);
        assert_eq!(time, received());
    }

    #[test]
    fn unparsable_clock_falls_back_to_receive_time() {
        let (time, from_device) = resolve_source_time(&json!({"ts": "not a time"}), received());
        assert!(!from_device);
        assert_eq!(time, received());
    }

    /// A device booting without NTP reports epoch 0. Trusting it would open a
    /// hypertable chunk in 1970, so it must be rejected.
    #[test]
    fn unset_device_clock_is_rejected() {
        let (time, from_device) = resolve_source_time(&json!({"ts": 0}), received());
        assert!(!from_device);
        assert_eq!(time, received());
    }

    #[test]
    fn clock_beyond_the_skew_limit_is_rejected() {
        let too_late = received().timestamp() + MAX_CLOCK_SKEW_SECONDS + 60;
        let (time, from_device) = resolve_source_time(&json!({"ts": too_late}), received());
        assert!(!from_device);
        assert_eq!(time, received());
    }

    #[test]
    fn clock_inside_the_skew_limit_is_accepted() {
        let late = received().timestamp() + MAX_CLOCK_SKEW_SECONDS - 60;
        let (_, from_device) = resolve_source_time(&json!({"ts": late}), received());
        assert!(from_device);
    }

    /// An unusable first candidate must not shadow a good later one.
    #[test]
    fn later_field_wins_when_the_first_is_unusable() {
        expect_device_clock(
            json!({"ts": "garbage", "timestamp": "2026-08-10T12:00:05Z"}),
            "2026-08-10T12:00:05+00:00",
        );
    }
}
