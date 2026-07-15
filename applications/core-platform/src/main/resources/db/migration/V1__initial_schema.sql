-- V1: Initial schema, reconstructed for the thesis repository.
--
-- The production deployment predates this repo and used Flyway baselining
-- (baseline-version 1), so the original V1 never existed as a file. This
-- migration recreates the pre-V2 state so the full chain V1..V26 can
-- bootstrap an EMPTY database (local docker compose, CI, GKE).
--
-- Sources for the reconstruction:
--   • Live tables (never created by V2+): JPA entities (tenants, users,
--     user_tenant_roles, site_assignments, invitations, object_types,
--     device_templates).
--   • Legacy tables (dropped again in V8/V12/V14): column usage in the
--     V2..V14 migrations (sites, spaces, assets, contacts).
--   • measurements / ingestion_errors: the ingestion-service and
--     analytics-service SQL.
--
-- TimescaleDB features are guarded like in V10 so plain-Postgres test
-- containers can run the chain.

-- =====================================================================================
-- Extensions
-- =====================================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb') THEN
        CREATE EXTENSION IF NOT EXISTS timescaledb;
    END IF;
END;
$$;

-- =====================================================================================
-- Identity & access
-- =====================================================================================

CREATE TABLE tenants (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name       TEXT NOT NULL,
    config     JSONB,
    created_by UUID,
    type       TEXT NOT NULL DEFAULT 'standard',
    status     TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth0_sub     TEXT NOT NULL UNIQUE,
    email         TEXT,
    display_name  TEXT,
    avatar_url    TEXT,
    global_role   TEXT NOT NULL DEFAULT 'viewer',
    last_login_at TIMESTAMPTZ,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE user_tenant_roles (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    tenant_role TEXT NOT NULL DEFAULT 'viewer',
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_user_tenant UNIQUE (user_id, tenant_id)
);

CREATE TABLE invitations (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email       TEXT NOT NULL,
    tenant_id   UUID,
    tenant_role TEXT NOT NULL DEFAULT 'viewer',
    global_role TEXT NOT NULL DEFAULT 'viewer',
    invited_by  UUID NOT NULL,
    token       TEXT NOT NULL UNIQUE,
    accepted_at TIMESTAMPTZ,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================================================
-- Ontology type catalog (live) — objects/links themselves arrive in V5
-- =====================================================================================

CREATE TABLE object_types (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    display_name    TEXT NOT NULL,
    category        TEXT NOT NULL,
    description     TEXT,
    icon            TEXT,
    property_schema JSONB,
    sort_order      INTEGER,
    active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    -- Referenced by name in V3/V5/V10 ON CONFLICT clauses
    CONSTRAINT uq_object_type_name UNIQUE (name)
);

CREATE TABLE device_templates (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id          UUID REFERENCES tenants(id) ON DELETE CASCADE,
    name               TEXT NOT NULL,
    manufacturer       TEXT,
    model_number       TEXT,
    description        TEXT,
    object_type_id     UUID REFERENCES object_types(id),
    protocol           TEXT,
    default_signal_map JSONB,
    default_specs      JSONB,
    secrets_schema     JSONB,
    sort_order         INTEGER,
    active             BOOLEAN NOT NULL DEFAULT TRUE,
    created_at         TIMESTAMPTZ DEFAULT NOW(),
    updated_at         TIMESTAMPTZ DEFAULT NOW(),
    -- Referenced by name in V3/V4 ON CONFLICT clauses
    CONSTRAINT uq_device_template_name UNIQUE (name)
);

-- =====================================================================================
-- Legacy domain tables — migrated into the ontology layer by V5/V11 and
-- dropped by V8/V12/V14. Recreated here only so that chain can run.
-- =====================================================================================

CREATE TABLE sites (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id  UUID REFERENCES tenants(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    address    TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE spaces (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    site_id         UUID REFERENCES sites(id) ON DELETE CASCADE,
    parent_space_id UUID REFERENCES spaces(id) ON DELETE CASCADE,
    type            TEXT,
    name            TEXT NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_spaces_site   ON spaces(site_id);
CREATE INDEX idx_spaces_parent ON spaces(parent_space_id);

CREATE TABLE assets (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    site_id     UUID REFERENCES sites(id) ON DELETE SET NULL,
    space_id    UUID REFERENCES spaces(id) ON DELETE SET NULL,
    device_id   TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    type        TEXT,
    model_human TEXT,
    signal_map  JSONB,
    secrets     JSONB,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_assets_site      ON assets(site_id);
CREATE INDEX idx_assets_space     ON assets(space_id);
CREATE INDEX idx_assets_device_id ON assets(device_id);

CREATE TABLE contacts (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    space_id   UUID REFERENCES spaces(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    email      TEXT,
    phone      TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- site_assignments must exist before V14 re-points its site FK to objects.
-- The inline REFERENCES yields the constraint name site_assignments_site_id_fkey
-- that V14 drops.
CREATE TABLE site_assignments (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    site_id     UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    assigned_by UUID,
    notes       TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_site_assignment UNIQUE (user_id, site_id)
);

-- =====================================================================================
-- Time-series storage (written by ingestion-service, read by analytics-service)
-- =====================================================================================

CREATE TABLE measurements (
    time      TIMESTAMPTZ NOT NULL,
    device_id TEXT NOT NULL,
    metric_id SMALLINT NOT NULL,
    value     DOUBLE PRECISION
);

CREATE INDEX idx_measurements_device_metric_time
    ON measurements(device_id, metric_id, time DESC);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
        PERFORM create_hypertable('measurements', 'time', if_not_exists => TRUE);
    END IF;
END;
$$;

CREATE TABLE ingestion_errors (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    raw_payload   JSONB,
    error_message TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);
