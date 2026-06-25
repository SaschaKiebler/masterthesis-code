-- Event Templates: pre-defined templates for manual event creation (ADR-013 Log Event)
CREATE TABLE event_templates (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID,                          -- NULL = system-wide default
    label        VARCHAR(200) NOT NULL,         -- Display name, e.g., "Jahreswartung Kessel"
    event_type   VARCHAR(100) NOT NULL,         -- MAINTENANCE, FAULT, COMMISSIONING, SETPOINT_CHANGE
    severity     VARCHAR(20) NOT NULL DEFAULT 'INFO',
    summary      TEXT NOT NULL,                 -- Pre-filled summary text
    sort_order   INT NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_event_templates_tenant ON event_templates(tenant_id);

-- Seed system-wide defaults (tenant_id = NULL)
INSERT INTO event_templates (tenant_id, label, event_type, severity, summary, sort_order) VALUES
    (NULL, 'Jahreswartung Kessel',       'MAINTENANCE',     'INFO',  'Jahreswartung Kessel durchgeführt',       1),
    (NULL, 'Filter gewechselt',          'MAINTENANCE',     'INFO',  'Filter gewechselt',                       2),
    (NULL, 'Umwälzpumpe getauscht',      'MAINTENANCE',     'INFO',  'Umwälzpumpe getauscht',                   3),
    (NULL, 'Heizungsanlage gespült',     'MAINTENANCE',     'INFO',  'Heizungsanlage gespült',                  4),
    (NULL, 'Heizkurve angepasst',        'SETPOINT_CHANGE', 'INFO',  'Heizkurve angepasst',                     5),
    (NULL, 'Fehlercode beobachtet',      'FAULT',           'ERROR', 'Fehlercode beobachtet',                   6),
    (NULL, 'Sensor installiert',         'COMMISSIONING',   'INFO',  'Sensor installiert und konfiguriert',     7);
