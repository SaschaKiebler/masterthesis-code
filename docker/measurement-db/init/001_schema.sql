-- Schema of the dedicated measurement store (TimescaleDB), applied once by
-- the container entrypoint on first start. DDL copied from core-platform's
-- V1__initial_schema.sql (which must stay untouched — Flyway checksums).
-- The empty measurements/ingestion_errors tables that V1 still creates in
-- the master-data PostgreSQL are a documented, harmless legacy.

CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE measurements (
    time      TIMESTAMPTZ NOT NULL,
    device_id TEXT NOT NULL,
    metric_id SMALLINT NOT NULL,
    value     DOUBLE PRECISION
);

CREATE INDEX idx_measurements_device_metric_time
    ON measurements(device_id, metric_id, time DESC);

SELECT create_hypertable('measurements', 'time', if_not_exists => TRUE);

CREATE TABLE ingestion_errors (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    raw_payload   JSONB,
    error_message TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);
