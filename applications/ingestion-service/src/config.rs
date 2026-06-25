//! Configuration loading for the Ingestion Service

use anyhow::Result;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct AppConfig {
    pub mqtt: MqttConfig,
    pub database: DatabaseConfig,
}

#[derive(Debug, Deserialize)]
pub struct MqttConfig {
    pub host: String,
    pub port: u16,
    pub client_id: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub topic: String,
    pub extra_topics: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct DatabaseConfig {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: String,
    pub dbname: String,
}

impl Default for MqttConfig {
    fn default() -> Self {
        Self {
            host: "localhost".to_string(),
            port: 1883,
            client_id: "ingestion-service".to_string(),
            username: None,
            password: None,
            topic: "house/+/sensor/#".to_string(),
            extra_topics: vec![
                "#".to_string(),
            ],
        }
    }
}

impl Default for DatabaseConfig {
    fn default() -> Self {
        Self {
            host: "localhost".to_string(),
            port: 5432,
            user: "postgres".to_string(),
            password: "password".to_string(),
            dbname: "digital_demon".to_string(),
        }
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
        client_id: std::env::var("MQTT_CLIENT_ID")
            .unwrap_or_else(|_| "ingestion-service".to_string()),
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
    };

    let database = DatabaseConfig {
        host: std::env::var("DB_HOST").unwrap_or_else(|_| "localhost".to_string()),
        port: std::env::var("DB_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(5432),
        user: std::env::var("DB_USER").unwrap_or_else(|_| "postgres".to_string()),
        password: std::env::var("DB_PASSWORD").unwrap_or_else(|_| "password".to_string()),
        dbname: std::env::var("DB_NAME").unwrap_or_else(|_| "digital_demon".to_string()),
    };

    Ok(AppConfig { mqtt, database })
}
