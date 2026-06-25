//! Database operations for the Ingestion Service

use anyhow::Result;
use deadpool_postgres::{Config, Pool, Runtime};
use tokio_postgres::NoTls;
use chrono::{DateTime, Utc};
use tracing::{info};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use std::collections::HashSet;
use crate::config::DatabaseConfig;

/// Cached set of known asset device_ids, refreshed periodically
pub struct AssetRegistry {
    device_ids: HashSet<String>,
    last_refresh: std::time::Instant,
}

pub type AssetRegistryCache = Arc<RwLock<AssetRegistry>>;

impl AssetRegistry {
    pub fn new() -> Self {
        Self {
            device_ids: HashSet::new(),
            last_refresh: std::time::Instant::now(),
        }
    }

    pub fn contains(&self, device_id: &str) -> bool {
        self.device_ids.contains(device_id)
    }
}

/// Load all known device_ids from physical_devices and update the registry cache.
pub async fn refresh_asset_registry(
    pool: &Pool,
    registry: &AssetRegistryCache,
) -> Result<()> {
    let client = pool.get().await?;
    let rows = client.query("SELECT device_id FROM physical_devices", &[]).await?;

    let device_ids: HashSet<String> = rows.iter().map(|r| r.get(0)).collect();
    let count = device_ids.len();

    {
        let mut reg = registry.write().await;
        reg.device_ids = device_ids;
        reg.last_refresh = std::time::Instant::now();
    }

    info!("Asset registry refreshed: {} known devices", count);
    Ok(())
}

/// Check whether a device_id belongs to a registered asset (pure in-memory lookup).
pub async fn is_known_device(
    registry: &AssetRegistryCache,
    device_id: &str,
) -> bool {
    let reg = registry.read().await;
    reg.contains(device_id)
}

/// Cached secrets for device decryption
pub type SecretsCache = Arc<RwLock<HashMap<String, serde_json::Value>>>;

/// Cached signal maps for metric_id resolution (None = no signal_map for this device)
pub type SignalMapCache = Arc<RwLock<HashMap<String, Option<serde_json::Value>>>>;

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

/// Insert a measurement into the database
pub async fn insert_measurement(
    pool: &Pool,
    device_id: &str,
    metric_id: i16,
    value: f64,
    time: DateTime<Utc>,
) -> Result<()> {
    let client = pool.get().await?;
    
    client.execute(
        "INSERT INTO measurements (time, device_id, metric_id, value) VALUES ($1, $2, $3, $4)",
        &[&time, &device_id, &metric_id, &value],
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

/// Get the signal_map for a device (metric_id → name/unit decoder ring)
/// Uses a cache to avoid repeated DB lookups
pub async fn get_device_signal_map(
    pool: &Pool,
    cache: &SignalMapCache,
    device_id: &str,
) -> Result<Option<serde_json::Value>> {
    // Check cache first
    {
        let cache_read = cache.read().await;
        if let Some(signal_map) = cache_read.get(device_id) {
            return Ok(signal_map.clone());
        }
    }

    // Reconstruct signal_map from metric_points (migrated from assets.signal_map in V11).
    // Returns a JSON object keyed by metric_id string, matching the original signal_map shape.
    let client = pool.get().await?;
    let row = client.query_opt(
        "SELECT json_object_agg(
             mp.metric_id::text,
             json_build_object(
                 'name',   o.display_name,
                 'unit',   mp.unit,
                 'min',    mp.min_value,
                 'max',    mp.max_value,
                 'source', mp.source,
                 'field',  mp.field
             )
         )
         FROM metric_points mp
         JOIN objects o ON o.id = mp.id
         WHERE mp.device_id = $1",
        &[&device_id],
    ).await?;

    let signal_map = match row {
        Some(r) => {
            let val: Option<serde_json::Value> = r.get(0);
            match val {
                Some(v) if v.is_object() && !v.as_object().unwrap().is_empty() => Some(v),
                _ => None,
            }
        }
        None => None,
    };

    // Cache it (including None to avoid repeated lookups)
    {
        let mut cache_write = cache.write().await;
        cache_write.insert(device_id.to_string(), signal_map.clone());
    }

    Ok(signal_map)
}

/// Clear the signal map cache so updated configs are picked up on next message.
pub async fn clear_signal_map_cache(cache: &SignalMapCache) {
    let mut cache_write = cache.write().await;
    let count = cache_write.len();
    cache_write.clear();
    info!("Signal map cache cleared ({} entries)", count);
}

/// Clear the secrets cache so updated secrets are picked up on next message.
pub async fn clear_secrets_cache(cache: &SecretsCache) {
    let mut cache_write = cache.write().await;
    let count = cache_write.len();
    cache_write.clear();
    info!("Secrets cache cleared ({} entries)", count);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_asset_registry_new_is_empty() {
        let registry = AssetRegistry::new();
        assert!(!registry.contains("any-device"));
    }

    #[test]
    fn test_asset_registry_contains_inserted_device() {
        let mut registry = AssetRegistry::new();
        registry.device_ids.insert("SHELLY-001".to_string());
        registry.device_ids.insert("WMBUS-002".to_string());

        assert!(registry.contains("SHELLY-001"));
        assert!(registry.contains("WMBUS-002"));
        assert!(!registry.contains("UNKNOWN-999"));
    }

    #[tokio::test]
    async fn test_is_known_device_returns_true_for_registered() {
        let mut registry = AssetRegistry::new();
        registry.device_ids.insert("shellyplushi&t-AABB".to_string());
        let cache: AssetRegistryCache = Arc::new(RwLock::new(registry));

        assert!(is_known_device(&cache, "shellyplushi&t-AABB").await);
    }

    #[tokio::test]
    async fn test_is_known_device_returns_false_for_unregistered() {
        let registry = AssetRegistry::new();
        let cache: AssetRegistryCache = Arc::new(RwLock::new(registry));

        assert!(!is_known_device(&cache, "unknown-device").await);
    }

    #[tokio::test]
    async fn test_registry_update_reflects_in_lookup() {
        let registry = AssetRegistry::new();
        let cache: AssetRegistryCache = Arc::new(RwLock::new(registry));

        // Initially unknown
        assert!(!is_known_device(&cache, "NEW-DEVICE").await);

        // Simulate refresh by writing directly
        {
            let mut reg = cache.write().await;
            reg.device_ids.insert("NEW-DEVICE".to_string());
            reg.last_refresh = std::time::Instant::now();
        }

        // Now known
        assert!(is_known_device(&cache, "NEW-DEVICE").await);
    }
}

