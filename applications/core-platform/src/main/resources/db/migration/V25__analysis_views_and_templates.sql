-- Analysis Canvas: views (project-scoped saved analyses) and templates (universal, reusable)

CREATE TABLE analysis_views (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    definition  JSONB NOT NULL DEFAULT '{"version":1,"charts":[]}'::jsonb,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_analysis_views_project ON analysis_views(project_id);

CREATE TABLE analysis_templates (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE,  -- NULL = system template
    name        TEXT NOT NULL,
    description TEXT,
    category    TEXT,              -- e.g. "heating", "efficiency", "hydraulic"
    is_system   BOOLEAN NOT NULL DEFAULT false,
    definition  JSONB NOT NULL DEFAULT '{"version":1,"charts":[]}'::jsonb,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_analysis_templates_tenant ON analysis_templates(tenant_id);
CREATE INDEX idx_analysis_templates_system ON analysis_templates(is_system) WHERE is_system = true;
