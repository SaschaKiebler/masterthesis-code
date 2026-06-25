-- Seed: Shelly Pro 3EM device template with field-based signal_map (ADR-010)
-- This enables data-driven ingestion parsing — no code changes needed for new sensors.

-- 1. Ensure ENERGY_METER object type exists (system default, tenant_id = NULL)
INSERT INTO object_types (id, tenant_id, name, display_name, category, description, icon, property_schema, sort_order)
VALUES (
    'a0000000-0000-0000-0000-000000000001',
    NULL,
    'ENERGY_METER',
    'Energy Meter',
    'METER',
    '3-phase energy meter measuring power, voltage, current, and cumulative energy per phase.',
    'zap',
    '{"properties": {"phases": {"type": "integer", "title": "Number of Phases", "enum": [1, 3]}, "max_current_a": {"type": "number", "title": "Max Current (A)"}}}',
    10
)
ON CONFLICT ON CONSTRAINT uq_object_type_name DO NOTHING;

-- 2. Seed Shelly Pro 3EM device template with full field-based default_signal_map
INSERT INTO device_templates (id, tenant_id, name, manufacturer, model_number, description, object_type_id, protocol, default_signal_map, default_specs, secrets_schema, sort_order)
VALUES (
    'b0000000-0000-0000-0000-000000000001',
    NULL,
    'Shelly Pro 3EM',
    'Shelly',
    'SHEM-3',
    '3-phase energy meter with per-phase power, voltage, current, and cumulative energy counters. Publishes on em:0 and emdata:0 MQTT topics.',
    'a0000000-0000-0000-0000-000000000001',
    'MQTT',
    '{
        "4":  {"name": "total_active_power",     "unit": "W",  "source": "em:0",     "field": "total_act_power"},
        "15": {"name": "total_current",          "unit": "A",  "source": "em:0",     "field": "total_current"},
        "16": {"name": "frequency",              "unit": "Hz", "source": "em:0",     "field": "a_freq"},
        "17": {"name": "total_apparent_power",   "unit": "W",  "source": "em:0",     "field": "total_aprt_power"},
        "20": {"name": "phase_a_active_power",   "unit": "W",  "source": "em:0",     "field": "a_act_power"},
        "21": {"name": "phase_b_active_power",   "unit": "W",  "source": "em:0",     "field": "b_act_power"},
        "22": {"name": "phase_c_active_power",   "unit": "W",  "source": "em:0",     "field": "c_act_power"},
        "23": {"name": "phase_a_voltage",        "unit": "V",  "source": "em:0",     "field": "a_voltage"},
        "24": {"name": "phase_b_voltage",        "unit": "V",  "source": "em:0",     "field": "b_voltage"},
        "25": {"name": "phase_c_voltage",        "unit": "V",  "source": "em:0",     "field": "c_voltage"},
        "26": {"name": "phase_a_current",        "unit": "A",  "source": "em:0",     "field": "a_current"},
        "27": {"name": "phase_b_current",        "unit": "A",  "source": "em:0",     "field": "b_current"},
        "28": {"name": "phase_c_current",        "unit": "A",  "source": "em:0",     "field": "c_current"},
        "5":  {"name": "total_active_energy",    "unit": "Wh", "source": "emdata:0", "field": "total_act"},
        "30": {"name": "phase_a_active_energy",  "unit": "Wh", "source": "emdata:0", "field": "a_total_act_energy"},
        "31": {"name": "phase_b_active_energy",  "unit": "Wh", "source": "emdata:0", "field": "b_total_act_energy"},
        "32": {"name": "phase_c_active_energy",  "unit": "Wh", "source": "emdata:0", "field": "c_total_act_energy"},
        "33": {"name": "total_return_energy",    "unit": "Wh", "source": "emdata:0", "field": "total_act_ret"},
        "34": {"name": "phase_a_return_energy",  "unit": "Wh", "source": "emdata:0", "field": "a_total_act_ret_energy"},
        "35": {"name": "phase_b_return_energy",  "unit": "Wh", "source": "emdata:0", "field": "b_total_act_ret_energy"},
        "36": {"name": "phase_c_return_energy",  "unit": "Wh", "source": "emdata:0", "field": "c_total_act_ret_energy"}
    }',
    '{"phases": 3, "max_current_a": 120}',
    '{}',
    10
)
ON CONFLICT ON CONSTRAINT uq_device_template_name DO NOTHING;
