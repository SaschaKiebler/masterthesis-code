-- Schema of the dedicated measurement store (TimescaleDB), applied once by
-- the container entrypoint on first start. DDL originally copied from
-- core-platform's V1__initial_schema.sql (which must stay untouched — Flyway
-- checksums); the ingest-timestamp columns below are deliberately only here,
-- because this is the store ingestion actually writes to. The empty
-- measurements/ingestion_errors tables that V1 still creates in the
-- master-data PostgreSQL are a documented, harmless legacy.
--
-- Keep in sync with the inline ConfigMap in
-- infrastructure/kubernetes/base/measurement-db.yaml.

CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE measurements (
    time         TIMESTAMPTZ NOT NULL,
    device_id    TEXT NOT NULL,
    metric_id    SMALLINT NOT NULL,
    value        DOUBLE PRECISION,

    -- Evaluation instrumentation (thesis ch. 6: QS-PER-01/02, QS-INT-02).
    -- received_at  = when ingestion took the message off MQTT, i.e. the
    --                system entry the load scenarios measure from. Nullable
    --                so rows written before this instrumentation stay valid
    --                instead of being backfilled with a timestamp that would
    --                assert something untrue.
    -- persisted_at = when the row reached this store; the database fills it,
    --                which keeps the write path a single INSERT.
    -- Ingest latency is persisted_at - received_at.
    received_at  TIMESTAMPTZ,
    persisted_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
