//! Kafka publisher for processed measurement batches.
//!
//! After the ingestion service writes measurements to TimescaleDB it publishes
//! a `MeasurementBatch` protobuf message to the `measurement.ingested` Kafka
//! topic, keyed by device id (see docs/architecture/event-catalog.md).
//! Core-platform consumes the topic and runs threshold and KPI evaluation
//! without blocking the ingestion hot path.

use chrono::{DateTime, Utc};
use prost::Message;
use prost_types::Timestamp;
use rdkafka::config::ClientConfig;
use rdkafka::producer::{FutureProducer, FutureRecord};
use std::time::Duration;
use tracing::warn;

use crate::config::KafkaConfig;
use crate::proto::core::v1::{IngestedMeasurement, MeasurementBatch};

/// A single parsed measurement ready for publishing.
pub struct IngestedPoint {
    pub metric_id: i16,
    pub value: f64,
    pub time: DateTime<Utc>,
}

/// Wraps the rdkafka producer with the topic it publishes to.
///
/// Creating it does not contact the broker; librdkafka connects lazily and
/// keeps retrying in the background, so ingestion starts fine while Kafka
/// is still coming up.
pub struct MeasurementPublisher {
    producer: FutureProducer,
    topic: String,
}

impl MeasurementPublisher {
    pub fn new(cfg: &KafkaConfig) -> anyhow::Result<Self> {
        let producer: FutureProducer = ClientConfig::new()
            .set("bootstrap.servers", &cfg.bootstrap_servers)
            .set("client.id", &cfg.client_id)
            // Idempotence implies acks=all and retry sequencing, so broker-side
            // retries can neither duplicate nor reorder a device's batches.
            .set("enable.idempotence", "true")
            // The DB write is the source of truth. An event that cannot be
            // delivered within this window is dropped with a warning instead
            // of buffering forever.
            .set("message.timeout.ms", "10000")
            .create()?;

        Ok(Self {
            producer,
            topic: cfg.measurement_topic.clone(),
        })
    }

    /// Encode a `MeasurementBatch` and publish it keyed by `device_id`, so all
    /// batches of one device land on the same partition and stay ordered.
    ///
    /// This is fire-and-forget: a delivery failure is logged as a warning but
    /// never propagates — the DB write has already succeeded and that is the
    /// source of truth.
    pub async fn publish_batch(&self, device_id: &str, points: &[IngestedPoint]) {
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

        let record = FutureRecord::to(&self.topic)
            .key(device_id)
            .payload(&payload);

        // The Duration bounds how long we block if the local send queue is
        // full; delivery itself is awaited via the returned future.
        if let Err((e, _)) = self.producer.send(record, Duration::from_secs(5)).await {
            warn!(
                device_id = device_id,
                error = ?e,
                "Failed to publish MeasurementBatch to Kafka — event evaluation skipped for this batch"
            );
        }
    }
}

fn to_proto_timestamp(dt: DateTime<Utc>) -> Timestamp {
    Timestamp {
        seconds: dt.timestamp(),
        nanos: dt.timestamp_subsec_nanos() as i32,
    }
}
