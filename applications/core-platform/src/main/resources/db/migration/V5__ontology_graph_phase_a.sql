-- V5: Ontology Graph — Phase A (ADR-011)
-- Introduces objects (supertype), link_types, and links tables.
-- Backfills graph from existing FK-based relationships (dual-write period).
-- Phase A is purely ADDITIVE: no existing tables are modified, no FK constraints
-- added to existing typed tables. Those happen in Phase B (backend) and Phase D (cleanup).
-- Date: 2026-02-18

-- =====================================================================================
-- SECTION 1: DDL — New Ontology Graph Tables
-- =====================================================================================

-- objects: Universal supertype for every domain entity.
-- Every site, space, asset, contact, and logical object gets a row here.
-- The same UUID is shared between this table and the typed extension table.
-- Phase A: tenant_id is nullable to accommodate edge-case dev data.
-- Phase D: NOT NULL will be enforced after full migration is validated.
CREATE TABLE IF NOT EXISTS objects (
    id             UUID PRIMARY KEY,            -- same UUID as typed extension table (sites, spaces, assets, contacts)
    object_type_id UUID NOT NULL REFERENCES object_types(id),
    tenant_id      UUID REFERENCES tenants(id) ON DELETE CASCADE,  -- access-control scope
    display_name   TEXT,                        -- denormalized for graph query results
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_objects_type   ON objects(object_type_id);
CREATE INDEX IF NOT EXISTS idx_objects_tenant ON objects(tenant_id);

-- link_types: Defines valid relationship kinds between object types.
-- source/target_object_type_id = NULL means "any type allowed" (enforced at application layer in Phase B).
CREATE TABLE IF NOT EXISTS link_types (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                  TEXT NOT NULL UNIQUE,   -- machine key: 'CONTAINS', 'FEEDS', 'SENSES'
    display_name          TEXT NOT NULL,           -- UI label: 'Contains', 'Feeds', 'Senses'
    description           TEXT,
    source_object_type_id UUID REFERENCES object_types(id),  -- NULL = any source type
    target_object_type_id UUID REFERENCES object_types(id),  -- NULL = any target type
    inverse_name          TEXT,                   -- e.g. CONTAINS → CONTAINED_BY
    properties_schema     JSONB DEFAULT '{}'::jsonb,
    created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- links: Universal relationship table.
-- Replaces the unused `relationships` table and all FK-based domain relationships.
CREATE TABLE IF NOT EXISTS links (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    link_type_id     UUID NOT NULL REFERENCES link_types(id),
    source_object_id UUID NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
    target_object_id UUID NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
    properties       JSONB DEFAULT '{}'::jsonb,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_link UNIQUE (source_object_id, target_object_id, link_type_id)
);

CREATE INDEX IF NOT EXISTS idx_links_source      ON links(source_object_id);
CREATE INDEX IF NOT EXISTS idx_links_target      ON links(target_object_id);
CREATE INDEX IF NOT EXISTS idx_links_type        ON links(link_type_id);
CREATE INDEX IF NOT EXISTS idx_links_source_type ON links(source_object_id, link_type_id);
CREATE INDEX IF NOT EXISTS idx_links_target_type ON links(target_object_id, link_type_id);

-- =====================================================================================
-- SECTION 2: Seed — Expanded Object Types
-- Already seeded by prior migrations:
--   a0000000-0000-0000-0000-000000000001 = ENERGY_METER  (V3)
--   a0000000-0000-0000-0000-000000000002 = DIGITAL_INPUT (V4)
-- Adding structural (buildings, spaces), logical (circuits, zones), and generic device types.
-- =====================================================================================

INSERT INTO object_types (id, tenant_id, name, display_name, category, description, icon, sort_order)
VALUES
    -- Structural types
    ('a0000000-0000-0000-0000-000000000003', NULL, 'BUILDING',            'Building',             'STRUCTURE', 'Physical building or site managed by a heating consultant.',         'building-2',  1),
    ('a0000000-0000-0000-0000-000000000004', NULL, 'FLOOR',              'Floor',                'SPACE',     'A floor level within a building.',                                   'layers',      2),
    ('a0000000-0000-0000-0000-000000000005', NULL, 'APARTMENT',          'Apartment',            'SPACE',     'A residential or commercial unit within a building.',                 'home',        3),
    ('a0000000-0000-0000-0000-000000000006', NULL, 'ROOM',               'Room',                 'SPACE',     'An individual room within an apartment or building.',                 'door-open',   4),
    ('a0000000-0000-0000-0000-000000000007', NULL, 'BASEMENT',           'Basement',             'SPACE',     'A below-grade space, typically housing mechanical systems.',          'archive',     5),
    ('a0000000-0000-0000-0000-000000000008', NULL, 'COMMON_AREA',        'Common Area',          'SPACE',     'Shared space accessible to all building occupants (e.g. stairwell).','users',       6),
    ('a0000000-0000-0000-0000-000000000009', NULL, 'TECHNICAL_ROOM',     'Technical Room',       'SPACE',     'Mechanical or utility room housing heating and infrastructure.',       'settings',    7),
    -- Logical / system types (new — enable heating circuit graph modelling)
    ('a0000000-0000-0000-0000-000000000010', NULL, 'HEATING_CIRCUIT',    'Heating Circuit',      'SYSTEM',    'A logical hydraulic loop connecting boiler, distribution, and emitters.','git-branch', 10),
    ('a0000000-0000-0000-0000-000000000011', NULL, 'HEATING_ZONE',       'Heating Zone',         'SYSTEM',    'A group of spaces controlled by a single thermostat or valve group.', 'thermometer',11),
    ('a0000000-0000-0000-0000-000000000012', NULL, 'DISTRIBUTION_NETWORK','Distribution Network','SYSTEM',    'Primary or secondary piping network distributing heat within a building.','git-merge',12),
    -- Person / contact type
    ('a0000000-0000-0000-0000-000000000013', NULL, 'PERSON',             'Person',               'CONTACT',   'A resident, owner, or contact person associated with a space.',       'user',        20),
    -- Generic device types (fallbacks for assets using the legacy `type` column)
    ('a0000000-0000-0000-0000-000000000014', NULL, 'GENERIC_SENSOR',     'Sensor',               'SENSOR',    'Generic sensor device (use a specific type for known hardware).',     'activity',    30),
    ('a0000000-0000-0000-0000-000000000015', NULL, 'ACTUATOR',           'Actuator',             'ACTUATOR',  'Actuator device (valve, relay, etc.).',                               'sliders',     31),
    ('a0000000-0000-0000-0000-000000000016', NULL, 'CONTROLLER',         'Controller',           'CONTROLLER','Heating or environmental controller (e.g. room thermostat).',         'cpu',         32),
    ('a0000000-0000-0000-0000-000000000017', NULL, 'GATEWAY',            'Gateway',              'GATEWAY',   'Communication gateway connecting field devices to the platform.',     'radio',       33),
    ('a0000000-0000-0000-0000-000000000018', NULL, 'BOILER',             'Boiler',               'DEVICE',    'Heating boiler or heat generator.',                                   'flame',       34),
    ('a0000000-0000-0000-0000-000000000019', NULL, 'PUMP',               'Pump',                 'DEVICE',    'Circulation pump in the heating system.',                             'wind',        35),
    ('a0000000-0000-0000-0000-000000000020', NULL, 'HEAT_METER',         'Heat Meter',           'METER',     'Meter measuring thermal energy consumption (kWh).',                   'gauge',       36)
ON CONFLICT ON CONSTRAINT uq_object_type_name DO NOTHING;

-- =====================================================================================
-- SECTION 3: Seed — Link Types
-- Using deterministic UUIDs (c = connect prefix) for stable cross-env references.
-- source/target_object_type_id = NULL (any type) for Phase A flexibility.
-- =====================================================================================

INSERT INTO link_types (id, name, display_name, description, inverse_name, source_object_type_id, target_object_type_id)
VALUES
    ('c0000000-0000-0000-0000-000000000001', 'CONTAINS',         'Contains',          'Spatial containment: building→floor→apartment→room, or system→subsystem.',            'CONTAINED_BY',   NULL, NULL),
    ('c0000000-0000-0000-0000-000000000002', 'INSTALLED_IN',     'Installed In',      'A device is physically installed inside a space (room-level precision).',              'HAS_DEVICE',     NULL, NULL),
    ('c0000000-0000-0000-0000-000000000003', 'INSTALLED_AT',     'Installed At',      'A device is assigned to a building without a specific room (site-level).',             'HAS_DEVICE',     NULL, NULL),
    ('c0000000-0000-0000-0000-000000000004', 'FEEDS',            'Feeds',             'Hydraulic supply flow: boiler → heating circuit → radiator. Also: system feeds zone.', 'FED_BY',         NULL, NULL),
    ('c0000000-0000-0000-0000-000000000005', 'RETURNS_TO',       'Returns To',        'Hydraulic return flow: radiator → boiler. Inverse of FEEDS.',                          'RECEIVES_RETURN',NULL, NULL),
    ('c0000000-0000-0000-0000-000000000006', 'CONTROLS',         'Controls',          'Source actively controls the target (valve→radiator, controller→boiler).',             'CONTROLLED_BY',  NULL, NULL),
    ('c0000000-0000-0000-0000-000000000007', 'SENSES',           'Senses',            'Source measures something about the target (temp sensor→room, flow sensor→pipe).',     'SENSED_BY',      NULL, NULL),
    ('c0000000-0000-0000-0000-000000000008', 'NETWORK_PARENT',   'Network Parent',    'Communication hierarchy: gateway is the network parent of wireless sensors.',           'NETWORK_CHILD',  NULL, NULL),
    ('c0000000-0000-0000-0000-000000000009', 'POWERS',           'Powers',            'Source provides electrical power to target (gateway→sensor).',                         'POWERED_BY',     NULL, NULL),
    ('c0000000-0000-0000-0000-000000000010', 'SERVES',           'Serves',            'A heating circuit or system serves a zone or space.',                                   'SERVED_BY',      NULL, NULL),
    ('c0000000-0000-0000-0000-000000000011', 'RESIDES_IN',       'Resides In',        'A person (resident/owner/contact) is associated with a space.',                         'HAS_RESIDENT',   NULL, NULL),
    ('c0000000-0000-0000-0000-000000000012', 'MANAGED_BY',       'Managed By',        'A building is managed or owned by a tenant organisation.',                              'MANAGES',        NULL, NULL)
ON CONFLICT ON CONSTRAINT link_types_name_key DO NOTHING;

-- =====================================================================================
-- SECTION 4: Backfill — objects from typed extension tables
-- Inserts one objects row per existing site, space, asset, and contact.
-- Uses the same UUID so the typed table id IS the objects id.
-- tenant_id is resolved via JOIN chains; may be NULL for orphaned dev data.
-- =====================================================================================

-- 4a. Sites → BUILDING objects
INSERT INTO objects (id, object_type_id, tenant_id, display_name, created_at, updated_at)
SELECT
    s.id,
    'a0000000-0000-0000-0000-000000000003'::uuid,
    s.tenant_id,
    s.name,
    s.created_at,
    COALESCE(s.updated_at, s.created_at)
FROM sites s
ON CONFLICT (id) DO NOTHING;

-- 4b. Spaces → typed SPACE objects (FLOOR/APARTMENT/ROOM/BASEMENT/COMMON_AREA/TECHNICAL_ROOM)
--     tenant_id resolved through site
INSERT INTO objects (id, object_type_id, tenant_id, display_name, created_at, updated_at)
SELECT
    sp.id,
    CASE sp.type
        WHEN 'FLOOR'          THEN 'a0000000-0000-0000-0000-000000000004'::uuid
        WHEN 'APARTMENT'      THEN 'a0000000-0000-0000-0000-000000000005'::uuid
        WHEN 'ROOM'           THEN 'a0000000-0000-0000-0000-000000000006'::uuid
        WHEN 'BASEMENT'       THEN 'a0000000-0000-0000-0000-000000000007'::uuid
        WHEN 'COMMON_AREA'    THEN 'a0000000-0000-0000-0000-000000000008'::uuid
        WHEN 'TECHNICAL_ROOM' THEN 'a0000000-0000-0000-0000-000000000009'::uuid
        ELSE                       'a0000000-0000-0000-0000-000000000006'::uuid  -- fallback to ROOM
    END,
    s.tenant_id,
    sp.name,
    sp.created_at,
    sp.created_at
FROM spaces sp
LEFT JOIN sites s ON sp.site_id = s.id
ON CONFLICT (id) DO NOTHING;

-- 4c. Assets → generic device objects (type column → object_type_id)
--     tenant_id resolved through site; nullable if asset has no site yet
INSERT INTO objects (id, object_type_id, tenant_id, display_name, created_at, updated_at)
SELECT
    a.id,
    CASE a.type
        WHEN 'SENSOR'     THEN 'a0000000-0000-0000-0000-000000000014'::uuid
        WHEN 'ACTUATOR'   THEN 'a0000000-0000-0000-0000-000000000015'::uuid
        WHEN 'CONTROLLER' THEN 'a0000000-0000-0000-0000-000000000016'::uuid
        WHEN 'GATEWAY'    THEN 'a0000000-0000-0000-0000-000000000017'::uuid
        WHEN 'HEATER'     THEN 'a0000000-0000-0000-0000-000000000018'::uuid
        WHEN 'PUMP'       THEN 'a0000000-0000-0000-0000-000000000019'::uuid
        ELSE                   'a0000000-0000-0000-0000-000000000014'::uuid  -- fallback to GENERIC_SENSOR
    END,
    s.tenant_id,
    a.name,
    a.created_at,
    COALESCE(a.updated_at, a.created_at)
FROM assets a
LEFT JOIN sites s ON a.site_id = s.id
ON CONFLICT (id) DO NOTHING;

-- 4d. Contacts → PERSON objects
--     tenant_id resolved through space → site
INSERT INTO objects (id, object_type_id, tenant_id, display_name, created_at, updated_at)
SELECT
    c.id,
    'a0000000-0000-0000-0000-000000000013'::uuid,
    s.tenant_id,
    c.name,
    c.created_at,
    COALESCE(c.updated_at, c.created_at)
FROM contacts c
JOIN spaces sp ON c.space_id = sp.id
LEFT JOIN sites s ON sp.site_id = s.id
ON CONFLICT (id) DO NOTHING;

-- =====================================================================================
-- SECTION 5: Backfill — links from existing FK columns
-- All link inserts guard with INNER JOINs against objects to ensure referential
-- integrity (objects must exist before links can reference them).
-- =====================================================================================

-- 5a. assets.site_id → INSTALLED_AT link (asset is assigned to a building)
INSERT INTO links (link_type_id, source_object_id, target_object_id, properties, created_at)
SELECT
    'c0000000-0000-0000-0000-000000000003'::uuid,
    a.id,
    a.site_id,
    '{}'::jsonb,
    a.created_at
FROM assets a
JOIN objects src ON src.id = a.id
JOIN objects tgt ON tgt.id = a.site_id
WHERE a.site_id IS NOT NULL
ON CONFLICT ON CONSTRAINT uq_link DO NOTHING;

-- 5b. assets.space_id → INSTALLED_IN link (asset is in a specific room)
INSERT INTO links (link_type_id, source_object_id, target_object_id, properties, created_at)
SELECT
    'c0000000-0000-0000-0000-000000000002'::uuid,
    a.id,
    a.space_id,
    '{}'::jsonb,
    a.created_at
FROM assets a
JOIN objects src ON src.id = a.id
JOIN objects tgt ON tgt.id = a.space_id
WHERE a.space_id IS NOT NULL
ON CONFLICT ON CONSTRAINT uq_link DO NOTHING;

-- 5c. spaces root (parent_space_id IS NULL) → CONTAINS from building
--     e.g. Building CONTAINS Ground Floor
INSERT INTO links (link_type_id, source_object_id, target_object_id, properties, created_at)
SELECT
    'c0000000-0000-0000-0000-000000000001'::uuid,
    sp.site_id,
    sp.id,
    '{}'::jsonb,
    sp.created_at
FROM spaces sp
JOIN objects src ON src.id = sp.site_id
JOIN objects tgt ON tgt.id = sp.id
WHERE sp.parent_space_id IS NULL
  AND sp.site_id IS NOT NULL
ON CONFLICT ON CONSTRAINT uq_link DO NOTHING;

-- 5d. spaces with parent (parent_space_id IS NOT NULL) → CONTAINS between spaces
--     e.g. Ground Floor CONTAINS Apartment 1A
INSERT INTO links (link_type_id, source_object_id, target_object_id, properties, created_at)
SELECT
    'c0000000-0000-0000-0000-000000000001'::uuid,
    sp.parent_space_id,
    sp.id,
    '{}'::jsonb,
    sp.created_at
FROM spaces sp
JOIN objects src ON src.id = sp.parent_space_id
JOIN objects tgt ON tgt.id = sp.id
WHERE sp.parent_space_id IS NOT NULL
ON CONFLICT ON CONSTRAINT uq_link DO NOTHING;

-- 5e. contacts.space_id → RESIDES_IN link (person lives in apartment/room)
INSERT INTO links (link_type_id, source_object_id, target_object_id, properties, created_at)
SELECT
    'c0000000-0000-0000-0000-000000000011'::uuid,
    c.id,
    c.space_id,
    '{}'::jsonb,
    c.created_at
FROM contacts c
JOIN objects src ON src.id = c.id
JOIN objects tgt ON tgt.id = c.space_id
WHERE c.space_id IS NOT NULL
ON CONFLICT ON CONSTRAINT uq_link DO NOTHING;
