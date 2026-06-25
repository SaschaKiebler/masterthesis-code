-- V15: Threshold Rules — per-metric-point alert rules evaluated by MeasurementEventEvaluator.
--
-- When the Rust ingestion service publishes a MeasurementBatch to Mosquitto,
-- core-platform evaluates each measurement against these rules and fires events
-- via EventService when a threshold is breached.
--
-- Date: 2026-02-24

CREATE TABLE threshold_rules (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- The metric point this rule applies to (ontology FK — no direct domain FK)
    metric_point_id  UUID NOT NULL REFERENCES objects(id) ON DELETE CASCADE,

    -- Comparison operator: GT (>), LT (<), GTE (>=), LTE (<=)
    operator         TEXT NOT NULL CHECK (operator IN ('GT', 'LT', 'GTE', 'LTE')),

    -- The threshold value in the unit declared on the metric point
    threshold        DOUBLE PRECISION NOT NULL,

    -- Severity of the event fired when this rule breaches
    severity         TEXT NOT NULL DEFAULT 'WARNING'
                         CHECK (severity IN ('INFO', 'WARNING', 'ERROR', 'CRITICAL')),

    -- Minimum seconds between two events for the same rule (prevents spam)
    cooldown_seconds INT NOT NULL DEFAULT 300,

    enabled          BOOLEAN NOT NULL DEFAULT TRUE,

    tenant_id        UUID NOT NULL,

    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Fast lookup of active rules for a given metric point (hot path)
CREATE INDEX idx_tr_metric_point_enabled ON threshold_rules(metric_point_id) WHERE enabled = TRUE;
CREATE INDEX idx_tr_tenant               ON threshold_rules(tenant_id);
