from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Measurement store (TimescaleDB) — analytics is its single reader.
    database_url: str = "postgresql://postgres:password@localhost:5433/digital_demon_measurements"
    # Master-data store (PostgreSQL) — read-only registry lookups for
    # transitional endpoints that still resolve metric-point ids themselves.
    registry_database_url: str = "postgresql://postgres:password@localhost:5432/digital_demon"
    db_min_pool: int = 2
    db_max_pool: int = 10
    log_level: str = "info"
    port: int = 8100
    workers: int = 1

    # Auth: validate the platform's self-issued HS256 tokens on all /stats
    # routes (same shared secret core signs with, env LOCAL_AUTH_JWT_SECRET).
    auth_enabled: bool = True
    local_auth_jwt_secret: str = "insecure-local-dev-secret-change-me"

    # Kafka / detection
    kafka_enabled: bool = True
    kafka_bootstrap_servers: str = "localhost:9092"
    kafka_consumer_group: str = "analytics"
    topic_measurement_ingested: str = "measurement.ingested"
    topic_rule_configured: str = "rule.configured"
    topic_anomaly_rule_configured: str = "anomaly-rule.configured"
    topic_device_configured: str = "device.configured"
    topic_threshold_breached: str = "threshold.breached"
    topic_anomaly_detected: str = "anomaly.detected"
    topic_partitions: int = 3
    topic_replicas: int = 1

    # Anomaly engine / weather context. Detector thresholds are NOT settings
    # anymore — they are per-rule template parameters (anomaly-rule.configured).
    weather_enabled: bool = True
    weather_base_url: str = "https://api.open-meteo.com/v1/forecast"
    weather_cache_ttl_seconds: int = 900
    weather_default_latitude: float = 48.78
    weather_default_longitude: float = 9.18
    weather_eval_interval_seconds: int = 300

    model_config = {"env_prefix": "", "case_sensitive": False}


settings = Settings()
