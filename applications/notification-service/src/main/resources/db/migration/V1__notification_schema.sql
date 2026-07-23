-- V1: Notification rule set and persisted Meldungen (thesis ch. 4.3, C3
-- notification service). Two kinds of rules stay strictly separate per the
-- event catalog: threshold rules are detection config owned by core;
-- notification rules are per-tenant policy owned by this service.

CREATE TABLE notification_rules (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL,
    name             TEXT NOT NULL,
    -- Filter: welche Detection-Events diese Regel greift
    event_types      TEXT[] NOT NULL DEFAULT '{threshold.breached,anomaly.detected}',
    min_severity     TEXT NOT NULL DEFAULT 'INFO'
                     CHECK (min_severity IN ('INFO','WARNING','ERROR','CRITICAL')),
    -- Dedup: gleicher Befund (type+device+metric) höchstens alle n Minuten
    cooldown_minutes INT  NOT NULL DEFAULT 15,
    -- Zustellung: Meldung entsteht immer, zusätzlich optional Webhook
    webhook_url      TEXT,
    webhook_token    TEXT,
    enabled          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_nr_tenant ON notification_rules(tenant_id) WHERE enabled;

CREATE TABLE notifications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    rule_id         UUID REFERENCES notification_rules(id) ON DELETE SET NULL,
    type            TEXT NOT NULL,          -- threshold.breached | anomaly.detected | ...
    severity        TEXT NOT NULL,
    device_id       TEXT NOT NULL,
    metric_id       INT  NOT NULL,
    asset_ref       UUID,                   -- metric_point id aus dem Envelope
    summary         TEXT NOT NULL,
    detail          JSONB NOT NULL DEFAULT '{}'::jsonb,
    detected_at     TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by TEXT
);
CREATE INDEX idx_n_tenant_time ON notifications(tenant_id, created_at DESC);
CREATE INDEX idx_n_unacked     ON notifications(tenant_id) WHERE acknowledged_at IS NULL;
