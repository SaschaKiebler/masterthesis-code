//! MQTT client and message handling
//!
//! Supports message format:
//! - Shelly Gen2+ native MQTT (topic-based routing, e.g., `<device-id>/status/temperature:0`)
//! 

use anyhow::{anyhow, Result};
use deadpool_postgres::Pool;
use rumqttc::{AsyncClient, Event, MqttOptions, Packet, QoS};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use tracing::{debug, error, info};

use crate::config::MqttConfig;
use crate::db::{self, AssetRegistry, AssetRegistryCache, SecretsCache, SignalMapCache};
use crate::parser;
use crate::publisher::{self, IngestedPoint};

/// Run the MQTT client and message processing loop
pub async fn run(cfg: &MqttConfig, pool: Pool) -> Result<()> {
    let mut mqtt_options = MqttOptions::new(&cfg.client_id, &cfg.host, cfg.port);
    mqtt_options.set_keep_alive(Duration::from_secs(30));

    // Set credentials if configured (required for authenticated brokers)
    if let (Some(username), Some(password)) = (&cfg.username, &cfg.password) {
        mqtt_options.set_credentials(username, password);
        info!("MQTT credentials set for user: {}", username);
    }

    let (client, mut eventloop) = AsyncClient::new(mqtt_options, 100);
    
    // Subscribe to the primary topic (envelope format from edge gateways)
    client.subscribe(&cfg.topic, QoS::AtLeastOnce).await?;
    info!("Subscribed to MQTT topic: {}", cfg.topic);

    // Subscribe to extra topics (Shelly native, etc.)
    for extra_topic in &cfg.extra_topics {
        client.subscribe(extra_topic, QoS::AtLeastOnce).await?;
        info!("Subscribed to extra MQTT topic: {}", extra_topic);
    }

    // Initialize caches
    let secrets_cache: SecretsCache = Arc::new(RwLock::new(HashMap::new()));
    let signal_map_cache: SignalMapCache = Arc::new(RwLock::new(HashMap::new()));

    // Initialize asset registry and perform initial load
    let asset_registry: AssetRegistryCache = Arc::new(RwLock::new(AssetRegistry::new()));
    db::refresh_asset_registry(&pool, &asset_registry).await?;

    // Spawn background task to refresh the asset registry and clear stale caches every 2 minutes
    {
        let pool_bg = pool.clone();
        let registry_bg = asset_registry.clone();
        let signal_map_cache_bg = signal_map_cache.clone();
        let secrets_cache_bg = secrets_cache.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(120));
            interval.tick().await; // skip the immediate first tick (already loaded above)
            loop {
                interval.tick().await;
                if let Err(e) = db::refresh_asset_registry(&pool_bg, &registry_bg).await {
                    error!("Failed to refresh asset registry: {:?}", e);
                }
                // Clear signal map and secrets caches so updated configs are picked up
                // on the next message from each device (lazy re-fetch from DB)
                db::clear_signal_map_cache(&signal_map_cache_bg).await;
                db::clear_secrets_cache(&secrets_cache_bg).await;
            }
        });
    }

    // Process incoming messages
    loop {
        match eventloop.poll().await {
            Ok(Event::Incoming(Packet::Publish(publish))) => {
                let topic = publish.topic.clone();
                let payload = String::from_utf8_lossy(&publish.payload).to_string();
                
                debug!("Received message on {}: {}", topic, payload);

                // Process in a spawned task to not block the event loop
                let pool_clone = pool.clone();
                let signal_map_cache_clone = signal_map_cache.clone();
                let registry_clone = asset_registry.clone();
                
                let client_clone = client.clone();
                tokio::spawn(async move {
                    if let Err(e) = process_message(&pool_clone, &signal_map_cache_clone, &registry_clone, &client_clone, &topic, &payload).await {
                        error!("Error processing message on {}: {:?}", topic, e);
                        
                        // Log to ingestion_errors table
                        if let Err(db_err) = db::insert_error(&pool_clone, &payload, &e.to_string()).await {
                            error!("Failed to log ingestion error: {:?}", db_err);
                        }
                    }
                });
            }
            Ok(Event::Incoming(Packet::ConnAck(_))) => {
                info!("Connected to MQTT broker");
            }
            Ok(_) => {
                // Other events (ping, etc.)
            }
            Err(e) => {
                error!("MQTT error: {:?}", e);
                // Brief pause before reconnecting
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        }
    }
}

/// Process a single MQTT message.
///
/// Routing logic:
/// 1. Try Shelly native format (topic-based detection via `/status/` in topic)
/// 2. Try Tasmota format (`tele/<device_id>/<type>` or `stat/<device_id>/<type>`)
/// 3. Try generic device format (first topic segment = device_id, rest = source)
async fn process_message(
    pool: &Pool,
    signal_map_cache: &SignalMapCache,
    asset_registry: &AssetRegistryCache,
    client: &AsyncClient,
    topic: &str,
    payload: &str,
) -> Result<()> {
    // Route 1: Check if this is a native Shelly message (topic-based detection)
    if let Some(shelly_info) = parser::parse_shelly_topic(topic) {
        // Gate: drop messages from unregistered devices
        if !db::is_known_device(asset_registry, &shelly_info.device_id).await {
            info!(
                "Dropping Shelly message from unregistered device: {}",
                shelly_info.device_id
            );
            return Ok(());
        }

        let timestamp = chrono::Utc::now();

        // Fetch signal_map for the device (cached) to resolve channel → metric_id
        let signal_map = db::get_device_signal_map(pool, signal_map_cache, &shelly_info.device_id).await?;

        let measurements = parser::parse_shelly(&shelly_info, payload, timestamp, signal_map.as_ref())?;
        let count = measurements.len();

        for m in &measurements {
            db::insert_measurement(pool, &shelly_info.device_id, m.metric_id, m.value, m.time).await?;
            debug!(
                "Inserted (Shelly): device={}, metric={}, value={}",
                shelly_info.device_id, m.metric_id, m.value
            );
        }

        if count > 0 {
            info!(
                "Processed {} Shelly measurements from device {} ({})",
                count, shelly_info.device_id, shelly_info.component
            );

            // Publish batch for threshold evaluation in core-platform (fire-and-forget)
            let points: Vec<IngestedPoint> = measurements
                .iter()
                .map(|m| IngestedPoint { metric_id: m.metric_id, value: m.value, time: m.time })
                .collect();
            publisher::publish_batch(client, &shelly_info.device_id, &points).await;
        }
        return Ok(());
    }

    // Route 2: Tasmota devices (tele/<device_id>/<type> or stat/<device_id>/<type>)
    if let Some(tasmota_info) = parser::parse_tasmota_topic(topic) {
        if !db::is_known_device(asset_registry, &tasmota_info.device_id).await {
            info!(
                "Dropping Tasmota message from unregistered device: {}",
                tasmota_info.device_id
            );
            return Ok(());
        }

        let timestamp = chrono::Utc::now();
        let signal_map = db::get_device_signal_map(pool, signal_map_cache, &tasmota_info.device_id).await?;

        let measurements = parser::parse_tasmota(&tasmota_info, payload, timestamp, signal_map.as_ref())?;
        let count = measurements.len();

        for m in &measurements {
            db::insert_measurement(pool, &tasmota_info.device_id, m.metric_id, m.value, m.time).await?;
            info!(
                "Inserted (Tasmota): device={}, metric={}, value={}",
                tasmota_info.device_id, m.metric_id, m.value
            );
        }

        if count > 0 {
            info!(
                "Processed {} Tasmota measurements from device {} ({})",
                count, tasmota_info.device_id, tasmota_info.message_type
            );

            let points: Vec<IngestedPoint> = measurements
                .iter()
                .map(|m| IngestedPoint { metric_id: m.metric_id, value: m.value, time: m.time })
                .collect();
            publisher::publish_batch(client, &tasmota_info.device_id, &points).await;
        }
        return Ok(());
    }

    // Route 3: Generic device (first topic segment = device_id, rest = source for signal_map)
    if let Some(generic_info) = parser::parse_generic_topic(topic) {
        if !db::is_known_device(asset_registry, &generic_info.device_id).await {
            info!(
                "Dropping generic message from unregistered device: {}",
                generic_info.device_id
            );
            return Ok(());
        }

        let timestamp = chrono::Utc::now();
        let signal_map = db::get_device_signal_map(pool, signal_map_cache, &generic_info.device_id).await?;

        let measurements = parser::parse_generic(&generic_info, payload, timestamp, signal_map.as_ref())?;
        let count = measurements.len();

        for m in &measurements {
            db::insert_measurement(pool, &generic_info.device_id, m.metric_id, m.value, m.time).await?;
            info!(
                "Inserted (Generic): device={}, metric={}, value={}",
                generic_info.device_id, m.metric_id, m.value
            );
        }

        if count > 0 {
            info!(
                "Processed {} generic measurements from device {} (source={})",
                count, generic_info.device_id, generic_info.source
            );

            let points: Vec<IngestedPoint> = measurements
                .iter()
                .map(|m| IngestedPoint { metric_id: m.metric_id, value: m.value, time: m.time })
                .collect();
            publisher::publish_batch(client, &generic_info.device_id, &points).await;
        }
        return Ok(());
    }

    Err(anyhow!("Unsupported MQTT message format (topic={})", topic))
}
