//! Ingestion Service
//!
//! This service:
//! 1. Subscribes to MQTT topics from edge gateways
//! 3. Parses the data into measurements
//! 4. Inserts into TimescaleDB

mod config;
mod db;
mod device_state;
mod mqtt;
mod proto;
mod publisher;
mod parser;

use anyhow::Result;
use tracing::{info};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| "ingestion_service=info".into()))
        .with(tracing_subscriber::fmt::layer())
        .init();

    info!("Starting Ingestion Service...");

    // Load configuration
    let cfg = config::load_config()?;
    info!("Configuration loaded: MQTT broker at {}:{}", cfg.mqtt.host, cfg.mqtt.port);

    // Initialize database pool
    let db_pool = db::create_pool(&cfg.database).await?;
    info!("Database pool created");

    // Initialize Kafka producer for measurement.ingested events
    let publisher = publisher::MeasurementPublisher::new(&cfg.kafka)?;
    info!(
        "Kafka producer created: brokers={}, topic={}",
        cfg.kafka.bootstrap_servers, cfg.kafka.measurement_topic
    );

    // Replay device.configured into the in-memory projection before accepting
    // any MQTT traffic, then keep following it live.
    let device_state = device_state::DeviceStateStore::start(&cfg.kafka).await?;

    // Initialize MQTT and start processing
    mqtt::run(&cfg.mqtt, db_pool, publisher, device_state).await?;

    Ok(())
}
