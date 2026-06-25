-- V17: KPI Formula Builder — user-defined computed KPIs on ontology objects.
--
-- Consultants define math formulas referencing live sensor data (e.g. COP = thermal_out / elec_in).
-- Each formula has named variables that bind to metric points directly or via graph traversal.
-- Results are written to derived_properties after MQTT batch evaluation.
--
-- Date: 2026-02-24

CREATE TABLE kpi_formulas (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    object_id    UUID NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
    name         VARCHAR(200) NOT NULL,
    display_name VARCHAR(200) NOT NULL,
    formula      TEXT NOT NULL,
    variables    JSONB NOT NULL DEFAULT '{}',
    unit         VARCHAR(50),
    enabled      BOOLEAN NOT NULL DEFAULT TRUE,
    tenant_id    UUID NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX kpi_formulas_object_id_idx ON kpi_formulas(object_id);
CREATE INDEX kpi_formulas_tenant_enabled_idx ON kpi_formulas(tenant_id, enabled) WHERE enabled = TRUE;
