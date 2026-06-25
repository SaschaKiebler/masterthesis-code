-- V6: Projects — group sites into consulting engagements (ADR-012)
-- A project groups 1+ sites for a consultant's work. Sites can belong to multiple projects.
-- Date: 2026-02-18

CREATE TABLE IF NOT EXISTS projects (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT,
    status      TEXT NOT NULL DEFAULT 'active',
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_projects_tenant ON projects(tenant_id);

CREATE TABLE IF NOT EXISTS project_sites (
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    site_id    UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    added_at   TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (project_id, site_id)
);

CREATE INDEX IF NOT EXISTS idx_project_sites_site ON project_sites(site_id);
