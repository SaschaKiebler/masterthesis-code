//! Configuration loading for the Ingestion Service

use anyhow::Result;
use serde::Deserialize;
use uuid::Uuid;

/// Shared-subscription group used unless `MQTT_SHARE_GROUP` overrides it.
const DEFAULT_SHARE_GROUP: &str = "ingestion";

#[derive(Debug, Deserialize)]
pub struct AppConfig {
    pub mqtt: MqttConfig,
    pub database: DatabaseConfig,
    pub kafka: KafkaConfig,
}

#[derive(Debug, Deserialize)]
pub struct MqttConfig {
    pub host: String,
    pub port: u16,
    /// Unique per running instance, see `instance_client_id`.
    pub client_id: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub topic: String,
    pub extra_topics: Vec<String>,
    /// Shared-subscription group. When set, every filter is subscribed as
    /// `$share/<group>/<filter>`, so the broker hands each message to exactly
    /// one member of the group instead of to every subscriber. That is what
    /// lets several replicas split one device stream instead of each writing
    /// the same measurement. All replicas must use the same group name; a
    /// different name would be an independent reader receiving a full copy.
    /// Set `MQTT_SHARE_GROUP` empty for brokers without shared subscriptions.
    pub share_group: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct DatabaseConfig {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: String,
    pub dbname: String,
}

#[derive(Debug, Deserialize)]
pub struct KafkaConfig {
    pub bootstrap_servers: String,
    pub client_id: String,
    /// Topic for processed measurement batches, `measurement.ingested`
    /// per docs/architecture/event-catalog.md.
    pub measurement_topic: String,
    /// Compacted topic carrying desired device configs, `device.configured`
    /// per docs/architecture/event-catalog.md.
    pub device_config_topic: String,
}

impl Default for MqttConfig {
    fn default() -> Self {
        Self {
            host: "localhost".to_string(),
            port: 1883,
            client_id: instance_client_id(
                "ingestion-service",
                std::env::var("HOSTNAME").ok().as_deref(),
            ),
            username: None,
            password: None,
            topic: "house/+/sensor/#".to_string(),
            extra_topics: vec![
                "#".to_string(),
            ],
            share_group: Some(DEFAULT_SHARE_GROUP.to_string()),
        }
    }
}

impl Default for DatabaseConfig {
    fn default() -> Self {
        // The dedicated measurement store (TimescaleDB) — ingestion writes
        // measurements/ingestion_errors only and never touches master data.
        Self {
            host: "localhost".to_string(),
            port: 5433,
            user: "postgres".to_string(),
            password: "password".to_string(),
            dbname: "digital_demon_measurements".to_string(),
        }
    }
}

/// Derive a client id that is unique to this instance.
///
/// A broker drops the older connection as soon as a second client connects
/// under the same client id, so replicas sharing one id would kick each other
/// in a reconnect loop instead of splitting the load. That is what pinned this
/// deployment to a single replica. Under Kubernetes the hostname is the pod
/// name, unique per replica and stable across container restarts, which keeps
/// the id readable in broker logs. Without a hostname a random suffix keeps
/// concurrent processes apart.
fn instance_client_id(base: &str, hostname: Option<&str>) -> String {
    let instance = hostname
        .map(str::trim)
        .filter(|h| !h.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| Uuid::new_v4().simple().to_string()[..8].to_string());

    // Pod names already carry the deployment name, so avoid doubling it.
    if instance.starts_with(base) {
        instance
    } else {
        format!("{base}-{instance}")
    }
}

pub fn load_config() -> Result<AppConfig> {
    // Load .env file if present
    dotenvy::dotenv().ok();

    // Build configuration from environment variables with defaults
    let mqtt = MqttConfig {
        host: std::env::var("MQTT_HOST").unwrap_or_else(|_| "localhost".to_string()),
        port: std::env::var("MQTT_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(1883),
        client_id: instance_client_id(
            &std::env::var("MQTT_CLIENT_ID").unwrap_or_else(|_| "ingestion-service".to_string()),
            std::env::var("HOSTNAME").ok().as_deref(),
        ),
        username: std::env::var("MQTT_USERNAME").ok().filter(|s| !s.is_empty()),
        password: std::env::var("MQTT_PASSWORD").ok().filter(|s| !s.is_empty()),
        topic: std::env::var("MQTT_TOPIC")
            .unwrap_or_else(|_| "house/+/sensor/#".to_string()),
        extra_topics: {
            let mut topics: Vec<String> = std::env::var("MQTT_EXTRA_TOPICS")
                .map(|s| s.split(',').map(|t| t.trim().to_string()).filter(|t| !t.is_empty()).collect())
                .unwrap_or_else(|_| vec![
                    "#".to_string(),
                ]);
            // Always subscribe to Tasmota telemetry topics
            if !topics.iter().any(|t| t == "#" || t == "tele/#") {
                topics.push("tele/#".to_string());
            }
            topics
        },
        share_group: {
            let group = std::env::var("MQTT_SHARE_GROUP")
                .unwrap_or_else(|_| DEFAULT_SHARE_GROUP.to_string());
            let group = group.trim().to_string();
            (!group.is_empty()).then_some(group)
        },
    };

    let database = DatabaseConfig {
        host: std::env::var("DB_HOST").unwrap_or_else(|_| "localhost".to_string()),
        port: std::env::var("DB_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(5433),
        user: std::env::var("DB_USER").unwrap_or_else(|_| "postgres".to_string()),
        password: std::env::var("DB_PASSWORD").unwrap_or_else(|_| "password".to_string()),
        dbname: std::env::var("DB_NAME").unwrap_or_else(|_| "digital_demon_measurements".to_string()),
    };

    let kafka = KafkaConfig {
        bootstrap_servers: std::env::var("KAFKA_BOOTSTRAP_SERVERS")
            .unwrap_or_else(|_| "localhost:9092".to_string()),
        client_id: std::env::var("KAFKA_CLIENT_ID")
            .unwrap_or_else(|_| "ingestion-service".to_string()),
        measurement_topic: std::env::var("KAFKA_MEASUREMENT_TOPIC")
            .unwrap_or_else(|_| "measurement.ingested".to_string()),
        device_config_topic: std::env::var("KAFKA_DEVICE_CONFIG_TOPIC")
            .unwrap_or_else(|_| "device.configured".to_string()),
    };

    Ok(AppConfig { mqtt, database, kafka })
}

#[cfg(test)]
#[path = "config_tests.rs"]
mod tests;
