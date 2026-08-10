//! Database operations for the Ingestion Service.
//!
//! Write-only: measurements and ingestion errors are inserted here. All
//! config reads (device gate, signal maps) come from the `device.configured`
//! Kafka projection in `device_state` instead of the database.

use anyhow::Result;
use chrono::{DateTime, Utc};
use deadpool_postgres::{Config, Pool, Runtime};
use tokio_postgres::NoTls;
use tracing::info;

use crate::config::DatabaseConfig;

/// Create a database connection pool
pub async fn create_pool(cfg: &DatabaseConfig) -> Result<Pool> {
    let mut pool_config = Config::new();
    pool_config.host = Some(cfg.host.clone());
    pool_config.port = Some(cfg.port);
    pool_config.user = Some(cfg.user.clone());
    pool_config.password = Some(cfg.password.clone());
    pool_config.dbname = Some(cfg.dbname.clone());

    let pool = pool_config.create_pool(Some(Runtime::Tokio1), NoTls)?;

    // Test connection
    let client = pool.get().await?;
    client.simple_query("SELECT 1").await?;
    info!("Database connection verified");

    Ok(pool)
}

/// Insert a measurement into the database.
///
/// `received_at` is the moment this service took the message off MQTT. It is
/// stored alongside the value so the evaluation can compute ingest latency as
/// `persisted_at - received_at`; `persisted_at` is filled by the database
/// default, which keeps this a single round trip.
pub async fn insert_measurement(
    pool: &Pool,
    device_id: &str,
    metric_id: i16,
    value: f64,
    time: DateTime<Utc>,
    received_at: DateTime<Utc>,
) -> Result<()> {
    let client = pool.get().await?;

    client.execute(
        "INSERT INTO measurements (time, device_id, metric_id, value, received_at) \
         VALUES ($1, $2, $3, $4, $5)",
        &[&time, &device_id, &metric_id, &value, &received_at],
    ).await?;

    Ok(())
}

/// Insert an ingestion error into the database
pub async fn insert_error(
    pool: &Pool,
    raw_payload: &str,
    error_message: &str,
) -> Result<()> {
    let client = pool.get().await?;

    let payload_json: serde_json::Value = serde_json::from_str(raw_payload)
        .unwrap_or_else(|_| serde_json::json!({"raw": raw_payload}));

    client.execute(
        "INSERT INTO ingestion_errors (raw_payload, error_message) VALUES ($1, $2)",
        &[&payload_json, &error_message],
    ).await?;

    Ok(())
}
