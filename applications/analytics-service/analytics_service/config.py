from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql://postgres:password@localhost:5432/digital_demon"
    db_min_pool: int = 2
    db_max_pool: int = 10
    log_level: str = "info"
    port: int = 8100
    workers: int = 1

    # Kafka / detection
    kafka_enabled: bool = True
    kafka_bootstrap_servers: str = "localhost:9092"
    kafka_consumer_group: str = "analytics"
    topic_measurement_ingested: str = "measurement.ingested"
    topic_rule_configured: str = "rule.configured"
    topic_threshold_breached: str = "threshold.breached"
    topic_anomaly_detected: str = "anomaly.detected"
    topic_partitions: int = 3
    topic_replicas: int = 1

    model_config = {"env_prefix": "", "case_sensitive": False}


settings = Settings()
