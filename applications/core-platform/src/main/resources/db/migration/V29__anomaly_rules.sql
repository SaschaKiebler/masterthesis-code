-- User-configurable anomaly rules: detector template instances with channel
-- bindings. A rule binds the roles a template declares (e.g. switch, demand,
-- actuator, suppress_while) to metric points; parameters (and, for the
-- generic `condition` template, the condition tree) live in params.
-- Published to the compacted anomaly-rule.configured topic by
-- AnomalyRuleConfigProjection; evaluated by the analytics anomaly engine.

CREATE TABLE anomaly_rules (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id        UUID NOT NULL,
    name             TEXT NOT NULL,
    detector         TEXT NOT NULL,
    params           JSONB NOT NULL DEFAULT '{}',
    -- Array of {"role": "...", "metricPointId": "..."}; the first entry's
    -- metric point becomes the finding's asset_ref.
    bindings         JSONB NOT NULL DEFAULT '[]',
    severity         TEXT NOT NULL DEFAULT 'WARNING'
                     CHECK (severity IN ('INFO', 'WARNING', 'ERROR', 'CRITICAL')),
    cooldown_seconds INTEGER NOT NULL DEFAULT 1800,
    enabled          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_anomaly_rules_tenant ON anomaly_rules (tenant_id);
CREATE INDEX idx_anomaly_rules_enabled ON anomaly_rules (enabled) WHERE enabled;
