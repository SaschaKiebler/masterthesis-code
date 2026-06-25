-- V10: ADR-013 Phase A — Ontology Evolution: ML & Prediction Readiness
-- Adds: physical_quantities, physical_devices, metric_points, events, derived_properties
-- Adds: 3 new object types (METRIC_POINT, PHYSICAL_QUANTITY, PHYSICAL_DEVICE)
-- Adds: 7 new link types (MEASURES, REALIZED_BY, HAS_METRIC, DERIVED_FROM, OCCURRED_ON, TRIGGERED_BY, PRECEDED_BY)
-- Purely ADDITIVE: no existing tables are modified.
-- Date: 2026-02-24

-- =====================================================================================
-- SECTION 1: New Object Types
-- Continuing the deterministic UUID convention from V5 (a0000000-0000-0000-0000-0000000000XX)
-- Last used: a0000000-0000-0000-0000-000000000020 (HEAT_METER)
-- =====================================================================================

INSERT INTO object_types (id, tenant_id, name, display_name, category, description, icon, sort_order)
VALUES
    ('a0000000-0000-0000-0000-000000000021', NULL, 'METRIC_POINT',      'Metric Point',      'METRIC', 'A named, typed measurement point on a device (e.g., Phase A Current).',       'activity',   40),
    ('a0000000-0000-0000-0000-000000000022', NULL, 'PHYSICAL_QUANTITY', 'Physical Quantity',  'METRIC', 'A semantic measurement category (e.g., Flow Temperature, Active Power).',    'ruler',      41),
    ('a0000000-0000-0000-0000-000000000023', NULL, 'PHYSICAL_DEVICE',   'Physical Device',    'DEVICE', 'A hardware device identity (MAC address, serial number, firmware version).', 'hard-drive', 42)
ON CONFLICT ON CONSTRAINT uq_object_type_name DO NOTHING;

-- =====================================================================================
-- SECTION 2: New Link Types
-- Continuing the deterministic UUID convention from V5 (c0000000-0000-0000-0000-0000000000XX)
-- Last used: c0000000-0000-0000-0000-000000000012 (MANAGED_BY)
-- =====================================================================================

INSERT INTO link_types (id, name, display_name, description, inverse_name, source_object_type_id, target_object_type_id)
VALUES
    ('c0000000-0000-0000-0000-000000000013', 'MEASURES',     'Measures',     'This metric point measures a specific physical quantity.',               'MEASURED_BY', NULL, NULL),
    ('c0000000-0000-0000-0000-000000000014', 'REALIZED_BY',  'Realized By',  'This logical object is realized by this physical hardware device.',      'REALIZES',    NULL, NULL),
    ('c0000000-0000-0000-0000-000000000015', 'HAS_METRIC',   'Has Metric',   'This asset has a metric point for a specific measurement.',              'METRIC_OF',   NULL, NULL),
    ('c0000000-0000-0000-0000-000000000016', 'DERIVED_FROM', 'Derived From', 'This metric point is derived from one or more other metric points.',     'DERIVES',     NULL, NULL),
    ('c0000000-0000-0000-0000-000000000017', 'OCCURRED_ON',  'Occurred On',  'This event occurred on a specific ontology object.',                     'HAS_EVENT',   NULL, NULL),
    ('c0000000-0000-0000-0000-000000000018', 'TRIGGERED_BY', 'Triggered By', 'This event was triggered by a specific metric point measurement.',       'TRIGGERED',   NULL, NULL),
    ('c0000000-0000-0000-0000-000000000019', 'PRECEDED_BY',  'Preceded By',  'This event was preceded by another event in a causal chain.',            'PRECEDES',    NULL, NULL)
ON CONFLICT ON CONSTRAINT link_types_name_key DO NOTHING;

-- =====================================================================================
-- SECTION 3: physical_quantities — Controlled vocabulary of measurable quantities
-- =====================================================================================

CREATE TABLE physical_quantities (
    id              UUID PRIMARY KEY REFERENCES objects(id) ON DELETE CASCADE,

    name            TEXT NOT NULL UNIQUE,
    display_name    TEXT NOT NULL,
    description     TEXT,

    dimension       TEXT NOT NULL,
    default_unit    TEXT NOT NULL,
    aggregation     TEXT NOT NULL DEFAULT 'MEAN',
    domain          TEXT DEFAULT 'HVAC',

    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pq_dimension ON physical_quantities(dimension);
CREATE INDEX idx_pq_domain    ON physical_quantities(domain);

-- =====================================================================================
-- SECTION 4: physical_devices — Hardware identity decoupled from ontology
-- =====================================================================================

CREATE TABLE physical_devices (
    id               UUID PRIMARY KEY REFERENCES objects(id) ON DELETE CASCADE,

    device_id        TEXT UNIQUE NOT NULL,
    manufacturer     TEXT,
    model            TEXT,
    firmware_version TEXT,
    protocol         TEXT,
    secrets          JSONB DEFAULT '{}'::jsonb,

    commissioned_at   TIMESTAMPTZ,
    decommissioned_at TIMESTAMPTZ,

    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pd_device_id ON physical_devices(device_id);

-- =====================================================================================
-- SECTION 5: metric_points — First-class measurement points (replaces signal_map)
-- =====================================================================================

CREATE TABLE metric_points (
    id               UUID PRIMARY KEY REFERENCES objects(id) ON DELETE CASCADE,

    device_id        TEXT NOT NULL,
    metric_id        SMALLINT NOT NULL,

    source           TEXT,
    field            TEXT,

    quantity_id      UUID REFERENCES objects(id),
    unit             TEXT NOT NULL,

    min_value        DOUBLE PRECISION,
    max_value        DOUBLE PRECISION,
    precision_digits SMALLINT,

    sample_interval_seconds INT,

    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT uq_metric_point UNIQUE (device_id, metric_id)
);

CREATE INDEX idx_mp_device        ON metric_points(device_id);
CREATE INDEX idx_mp_quantity      ON metric_points(quantity_id);
CREATE INDEX idx_mp_device_metric ON metric_points(device_id, metric_id);

-- =====================================================================================
-- SECTION 6: events — Discrete operational occurrences (TimescaleDB hypertable)
-- =====================================================================================

CREATE TABLE events (
    id              UUID DEFAULT uuid_generate_v4(),
    time            TIMESTAMPTZ NOT NULL,

    object_id       UUID NOT NULL,
    event_type      TEXT NOT NULL,

    severity        TEXT NOT NULL DEFAULT 'INFO',
    summary         TEXT NOT NULL,
    details         JSONB DEFAULT '{}'::jsonb,

    source          TEXT NOT NULL DEFAULT 'SYSTEM',
    source_id       UUID,

    resolved_at     TIMESTAMPTZ,
    resolved_by     UUID,
    resolution_note TEXT,

    tenant_id       UUID NOT NULL,

    PRIMARY KEY (id, time)
);

-- Convert to hypertable (guarded for test environments without TimescaleDB)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'timescaledb'
    ) THEN
        PERFORM create_hypertable('events', 'time', if_not_exists => TRUE);
        ALTER TABLE events SET (
            timescaledb.compress,
            timescaledb.compress_segmentby = 'object_id, event_type',
            timescaledb.compress_orderby = 'time DESC'
        );
        PERFORM add_compression_policy('events', INTERVAL '90 days');
    END IF;
END;
$$;

CREATE INDEX idx_events_object     ON events(object_id, time DESC);
CREATE INDEX idx_events_type       ON events(event_type, time DESC);
CREATE INDEX idx_events_tenant     ON events(tenant_id, time DESC);
CREATE INDEX idx_events_severity   ON events(severity, time DESC) WHERE severity IN ('WARNING', 'ERROR', 'CRITICAL');
CREATE INDEX idx_events_unresolved ON events(object_id, time DESC) WHERE resolved_at IS NULL;

-- =====================================================================================
-- SECTION 7: derived_properties — Computed values written back onto ontology objects
-- =====================================================================================

CREATE TABLE derived_properties (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    object_id     UUID NOT NULL REFERENCES objects(id) ON DELETE CASCADE,

    property_name TEXT NOT NULL,
    display_name  TEXT NOT NULL,

    value_numeric DOUBLE PRECISION,
    value_text    TEXT,
    value_json    JSONB,
    unit          TEXT,

    confidence    DOUBLE PRECISION,
    quality       TEXT DEFAULT 'GOOD',

    source_type   TEXT NOT NULL,
    source_id     TEXT,
    source_version TEXT,

    computed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    valid_from    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    valid_until   TIMESTAMPTZ,

    tenant_id     UUID NOT NULL REFERENCES tenants(id),

    CONSTRAINT uq_derived_current UNIQUE (object_id, property_name, valid_until)
);

CREATE INDEX idx_dp_object   ON derived_properties(object_id)    WHERE valid_until IS NULL;
CREATE INDEX idx_dp_property ON derived_properties(property_name) WHERE valid_until IS NULL;
CREATE INDEX idx_dp_tenant   ON derived_properties(tenant_id)     WHERE valid_until IS NULL;
CREATE INDEX idx_dp_source   ON derived_properties(source_type, source_id);
CREATE INDEX idx_dp_quality  ON derived_properties(quality)       WHERE quality != 'GOOD';

-- =====================================================================================
-- SECTION 8: Seed Physical Quantities (system-default objects)
-- Each quantity needs both an objects row and a physical_quantities row.
-- Using deterministic UUIDs: b0000000-0000-0000-0000-0000000000XX
-- =====================================================================================

-- 8a. Register quantity objects in objects table
INSERT INTO objects (id, object_type_id, tenant_id, display_name, created_at, updated_at)
VALUES
    -- Temperature
    ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000022', NULL, 'Flow Temperature',          NOW(), NOW()),
    ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000022', NULL, 'Return Temperature',        NOW(), NOW()),
    ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000022', NULL, 'Outdoor Temperature',       NOW(), NOW()),
    ('b0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000022', NULL, 'Room Temperature',          NOW(), NOW()),
    ('b0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000022', NULL, 'Hot Water Temperature',     NOW(), NOW()),
    ('b0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000022', NULL, 'Flue Gas Temperature',      NOW(), NOW()),
    ('b0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000022', NULL, 'Buffer Top Temperature',    NOW(), NOW()),
    ('b0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000022', NULL, 'Buffer Bottom Temperature', NOW(), NOW()),
    -- Power & Energy
    ('b0000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000022', NULL, 'Active Power',              NOW(), NOW()),
    ('b0000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000022', NULL, 'Apparent Power',            NOW(), NOW()),
    ('b0000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000022', NULL, 'Reactive Power',            NOW(), NOW()),
    ('b0000000-0000-0000-0000-000000000012', 'a0000000-0000-0000-0000-000000000022', NULL, 'Thermal Power',             NOW(), NOW()),
    ('b0000000-0000-0000-0000-000000000013', 'a0000000-0000-0000-0000-000000000022', NULL, 'Energy Consumed',           NOW(), NOW()),
    ('b0000000-0000-0000-0000-000000000014', 'a0000000-0000-0000-0000-000000000022', NULL, 'Energy Returned',           NOW(), NOW()),
    ('b0000000-0000-0000-0000-000000000015', 'a0000000-0000-0000-0000-000000000022', NULL, 'Thermal Energy',            NOW(), NOW()),
    ('b0000000-0000-0000-0000-000000000016', 'a0000000-0000-0000-0000-000000000022', NULL, 'Gas Consumption',           NOW(), NOW()),
    -- Electrical
    ('b0000000-0000-0000-0000-000000000017', 'a0000000-0000-0000-0000-000000000022', NULL, 'Voltage',                   NOW(), NOW()),
    ('b0000000-0000-0000-0000-000000000018', 'a0000000-0000-0000-0000-000000000022', NULL, 'Current',                   NOW(), NOW()),
    ('b0000000-0000-0000-0000-000000000019', 'a0000000-0000-0000-0000-000000000022', NULL, 'Frequency',                 NOW(), NOW()),
    ('b0000000-0000-0000-0000-000000000020', 'a0000000-0000-0000-0000-000000000022', NULL, 'Power Factor',              NOW(), NOW()),
    -- Flow & Pressure
    ('b0000000-0000-0000-0000-000000000021', 'a0000000-0000-0000-0000-000000000022', NULL, 'Volume Flow Rate',          NOW(), NOW()),
    ('b0000000-0000-0000-0000-000000000022', 'a0000000-0000-0000-0000-000000000022', NULL, 'Mass Flow Rate',            NOW(), NOW()),
    ('b0000000-0000-0000-0000-000000000023', 'a0000000-0000-0000-0000-000000000022', NULL, 'Pressure',                  NOW(), NOW()),
    ('b0000000-0000-0000-0000-000000000024', 'a0000000-0000-0000-0000-000000000022', NULL, 'Differential Pressure',     NOW(), NOW()),
    -- Environmental & State
    ('b0000000-0000-0000-0000-000000000025', 'a0000000-0000-0000-0000-000000000022', NULL, 'Relative Humidity',         NOW(), NOW()),
    ('b0000000-0000-0000-0000-000000000026', 'a0000000-0000-0000-0000-000000000022', NULL, 'CO2 Concentration',         NOW(), NOW()),
    ('b0000000-0000-0000-0000-000000000027', 'a0000000-0000-0000-0000-000000000022', NULL, 'Battery Level',             NOW(), NOW()),
    ('b0000000-0000-0000-0000-000000000028', 'a0000000-0000-0000-0000-000000000022', NULL, 'Valve Position',            NOW(), NOW()),
    ('b0000000-0000-0000-0000-000000000029', 'a0000000-0000-0000-0000-000000000022', NULL, 'Switch State',              NOW(), NOW()),
    ('b0000000-0000-0000-0000-000000000030', 'a0000000-0000-0000-0000-000000000022', NULL, 'Operating Hours',           NOW(), NOW()),
    ('b0000000-0000-0000-0000-000000000031', 'a0000000-0000-0000-0000-000000000022', NULL, 'Cycle Count',               NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- 8b. Insert physical_quantities extension table rows
INSERT INTO physical_quantities (id, name, display_name, description, dimension, default_unit, aggregation, domain)
VALUES
    -- Temperature
    ('b0000000-0000-0000-0000-000000000001', 'flow_temperature',          'Flow Temperature (Vorlauf)',    'Supply pipe temperature in heating circuit',    'TEMPERATURE',   'celsius',             'MEAN', 'HVAC'),
    ('b0000000-0000-0000-0000-000000000002', 'return_temperature',        'Return Temperature (Rucklauf)', 'Return pipe temperature in heating circuit',    'TEMPERATURE',   'celsius',             'MEAN', 'HVAC'),
    ('b0000000-0000-0000-0000-000000000003', 'outdoor_temperature',       'Outdoor Temperature',           'Ambient outside air temperature',               'TEMPERATURE',   'celsius',             'MEAN', 'ENVIRONMENTAL'),
    ('b0000000-0000-0000-0000-000000000004', 'room_temperature',          'Room Temperature',              'Indoor air temperature in a room',              'TEMPERATURE',   'celsius',             'MEAN', 'HVAC'),
    ('b0000000-0000-0000-0000-000000000005', 'hot_water_temperature',     'Hot Water Temperature',         'Domestic hot water temperature',                'TEMPERATURE',   'celsius',             'MEAN', 'HVAC'),
    ('b0000000-0000-0000-0000-000000000006', 'flue_gas_temperature',      'Flue Gas Temperature',          'Exhaust gas temperature from boiler',           'TEMPERATURE',   'celsius',             'MEAN', 'HVAC'),
    ('b0000000-0000-0000-0000-000000000007', 'buffer_temperature_top',    'Buffer Top Temperature',        'Temperature at top of buffer tank',             'TEMPERATURE',   'celsius',             'MEAN', 'HVAC'),
    ('b0000000-0000-0000-0000-000000000008', 'buffer_temperature_bottom', 'Buffer Bottom Temperature',     'Temperature at bottom of buffer tank',          'TEMPERATURE',   'celsius',             'MEAN', 'HVAC'),
    -- Power & Energy
    ('b0000000-0000-0000-0000-000000000009', 'active_power',              'Active Power',                  'Real electrical power',                         'POWER',         'watt',                'MEAN', 'ELECTRICAL'),
    ('b0000000-0000-0000-0000-000000000010', 'apparent_power',            'Apparent Power',                'Apparent electrical power',                     'POWER',         'volt_ampere',         'MEAN', 'ELECTRICAL'),
    ('b0000000-0000-0000-0000-000000000011', 'reactive_power',            'Reactive Power',                'Reactive electrical power',                     'POWER',         'var',                 'MEAN', 'ELECTRICAL'),
    ('b0000000-0000-0000-0000-000000000012', 'thermal_power',             'Thermal Power',                 'Thermal output power',                          'POWER',         'watt',                'MEAN', 'HVAC'),
    ('b0000000-0000-0000-0000-000000000013', 'energy_consumed',           'Energy Consumed',               'Cumulative energy consumed',                    'ENERGY',        'kilowatt_hour',       'SUM',  'ELECTRICAL'),
    ('b0000000-0000-0000-0000-000000000014', 'energy_returned',           'Energy Returned',               'Cumulative energy returned to grid',            'ENERGY',        'kilowatt_hour',       'SUM',  'ELECTRICAL'),
    ('b0000000-0000-0000-0000-000000000015', 'thermal_energy',            'Thermal Energy',                'Cumulative thermal energy transferred',         'ENERGY',        'kilowatt_hour',       'SUM',  'HVAC'),
    ('b0000000-0000-0000-0000-000000000016', 'gas_consumption',           'Gas Consumption',               'Cumulative gas volume consumed',                'ENERGY',        'cubic_meter',         'SUM',  'HVAC'),
    -- Electrical
    ('b0000000-0000-0000-0000-000000000017', 'voltage',                   'Voltage',                       'Electrical voltage',                            'VOLTAGE',       'volt',                'MEAN', 'ELECTRICAL'),
    ('b0000000-0000-0000-0000-000000000018', 'current',                   'Current',                       'Electrical current',                            'CURRENT',       'ampere',              'MEAN', 'ELECTRICAL'),
    ('b0000000-0000-0000-0000-000000000019', 'frequency',                 'Frequency',                     'Electrical frequency',                          'FREQUENCY',     'hertz',               'MEAN', 'ELECTRICAL'),
    ('b0000000-0000-0000-0000-000000000020', 'power_factor',              'Power Factor',                  'Ratio of active to apparent power',             'DIMENSIONLESS', 'ratio',               'MEAN', 'ELECTRICAL'),
    -- Flow & Pressure
    ('b0000000-0000-0000-0000-000000000021', 'volume_flow',               'Volume Flow Rate',              'Volume of fluid per time',                      'FLOW',          'cubic_meter_per_hour','MEAN', 'HVAC'),
    ('b0000000-0000-0000-0000-000000000022', 'mass_flow',                 'Mass Flow Rate',                'Mass of fluid per time',                        'FLOW',          'kilogram_per_hour',   'MEAN', 'HVAC'),
    ('b0000000-0000-0000-0000-000000000023', 'pressure',                  'Pressure',                      'Absolute or gauge pressure',                    'PRESSURE',      'bar',                 'MEAN', 'HVAC'),
    ('b0000000-0000-0000-0000-000000000024', 'differential_pressure',     'Differential Pressure',         'Pressure difference across component',          'PRESSURE',      'millibar',            'MEAN', 'HVAC'),
    -- Environmental & State
    ('b0000000-0000-0000-0000-000000000025', 'humidity',                  'Relative Humidity',             'Relative humidity of air',                      'HUMIDITY',      'percent',             'MEAN', 'ENVIRONMENTAL'),
    ('b0000000-0000-0000-0000-000000000026', 'co2_concentration',         'CO2 Concentration',             'Carbon dioxide concentration',                  'CONCENTRATION', 'ppm',                 'MEAN', 'ENVIRONMENTAL'),
    ('b0000000-0000-0000-0000-000000000027', 'battery_level',             'Battery Level',                 'Remaining battery charge',                      'DIMENSIONLESS', 'percent',             'LAST', 'ELECTRICAL'),
    ('b0000000-0000-0000-0000-000000000028', 'valve_position',            'Valve Position',                'Current valve opening position',                'DIMENSIONLESS', 'percent',             'LAST', 'HVAC'),
    ('b0000000-0000-0000-0000-000000000029', 'switch_state',              'Switch State',                  'Binary on/off state',                           'DIMENSIONLESS', 'binary',              'LAST', 'ELECTRICAL'),
    ('b0000000-0000-0000-0000-000000000030', 'operating_hours',           'Operating Hours',               'Total runtime hours of equipment',              'DURATION',      'hours',               'LAST', 'HVAC'),
    ('b0000000-0000-0000-0000-000000000031', 'cycle_count',               'Cycle Count',                   'Number of start/stop cycles',                   'DIMENSIONLESS', 'count',               'LAST', 'HVAC')
ON CONFLICT (id) DO NOTHING;
