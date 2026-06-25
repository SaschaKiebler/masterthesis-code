//! MQTT publisher for processed measurement batches.
//!
//! After the ingestion service writes measurements to TimescaleDB it publishes
//! a `MeasurementBatch` protobuf message to the `heizung/measurements/processed`
//! topic.  Core-platform subscribes and runs threshold evaluation without
//! blocking the ingestion hot path.

use chrono::{DateTime, Utc};
use prost::Message;
use prost_types::Timestamp;
use rumqttc::{AsyncClient, QoS};
use tracing::warn;

use crate::proto::core::v1::{IngestedMeasurement, MeasurementBatch};

/// The MQTT topic core-platform subscribes to for event evaluation.
pub const PROCESSED_TOPIC: &str = "heizung/measurements/processed";

/// A single parsed measurement ready for publishing.
pub struct IngestedPoint {
    pub metric_id: i16,
    pub value: f64,
    pub time: DateTime<Utc>,
}

/// Encode a `MeasurementBatch` and publish it to `heizung/measurements/processed`.
///
/// This is fire-and-forget: a publish failure is logged as a warning but never
/// propagates — the DB write has already succeeded and that is the source of truth.
pub async fn publish_batch(client: &AsyncClient, device_id: &str, points: &[IngestedPoint]) {
    if points.is_empty() {
        return;
    }

    let now = Utc::now();

    let batch = MeasurementBatch {
        device_id: device_id.to_string(),
        ingested_at: Some(to_proto_timestamp(now)),
        measurements: points
            .iter()
            .map(|p| IngestedMeasurement {
                metric_id: p.metric_id as i32,
                value: p.value,
                time: Some(to_proto_timestamp(p.time)),
            })
            .collect(),
    };

    let payload = batch.encode_to_vec();

    if let Err(e) = client
        .publish(PROCESSED_TOPIC, QoS::AtLeastOnce, false, payload)
        .await
    {
        // Non-fatal: DB write succeeded, event evaluation will simply be skipped
        // for this batch.  Core-platform can also poll for missed events if needed.
        warn!(
            device_id = device_id,
            error = ?e,
            "Failed to publish MeasurementBatch to MQTT — event evaluation skipped for this batch"
        );
    }
}

fn to_proto_timestamp(dt: DateTime<Utc>) -> Timestamp {
    Timestamp {
        seconds: dt.timestamp(),
        nanos: dt.timestamp_subsec_nanos() as i32,
    }
}
