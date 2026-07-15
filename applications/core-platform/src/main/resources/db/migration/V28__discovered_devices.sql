-- V28: Registry table for devices seen on the MQTT broker without
-- configuration. Fed by the device.discovered Kafka topic (published by the
-- device-management service, consumed by core). One row per device id,
-- upserted on every announcement.

CREATE TABLE discovered_devices (
    device_id      TEXT PRIMARY KEY,
    protocol       TEXT,
    sample_topic   TEXT,
    sample_payload TEXT,
    first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_discovered_devices_last_seen ON discovered_devices(last_seen_at DESC);
