CREATE TABLE dashboards (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    sort_order  INT NOT NULL DEFAULT 0,
    scope_type  TEXT,                    -- null (project-wide), SITE, HEATING_CIRCUIT, etc.
    scope_id    UUID,                    -- null or object ID
    layout      JSONB NOT NULL DEFAULT '{"columns":2,"widgets":[]}'::jsonb,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_dashboards_project ON dashboards(project_id);
