-- Seed: Shelly Plus I4 device template with field-based signal_map (ADR-010)
-- 4-channel digital input device. Each input publishes {"id":N, "state":true/false}
-- on MQTT topic input:0 .. input:3. State is mapped to 0.0 / 1.0 for storage.

-- 1. Ensure DIGITAL_INPUT object type exists (system default, tenant_id = NULL)
INSERT INTO object_types (id, tenant_id, name, display_name, category, description, icon, property_schema, sort_order)
VALUES (
    'a0000000-0000-0000-0000-000000000002',
    NULL,
    'DIGITAL_INPUT',
    'Digital Input',
    'SENSOR',
    'Multi-channel digital input device reporting binary on/off state per channel.',
    'toggle-left',
    '{"properties": {"channels": {"type": "integer", "title": "Number of Channels", "enum": [1, 2, 4]}}}',
    20
)
ON CONFLICT ON CONSTRAINT uq_object_type_name DO NOTHING;

-- 2. Seed Shelly Plus I4 device template with field-based default_signal_map
INSERT INTO device_templates (id, tenant_id, name, manufacturer, model_number, description, object_type_id, protocol, default_signal_map, default_specs, secrets_schema, sort_order)
VALUES (
    'b0000000-0000-0000-0000-000000000002',
    NULL,
    'Shelly Plus I4',
    'Shelly',
    'SNSN-0D24X',
    '4-channel digital input module. Reports binary state (on/off) per input channel via MQTT Gen2 status topics input:0 through input:3.',
    'a0000000-0000-0000-0000-000000000002',
    'MQTT',
    '{
        "1": {"name": "input_1_state", "unit": "bool", "source": "input:0", "field": "state"},
        "2": {"name": "input_2_state", "unit": "bool", "source": "input:1", "field": "state"},
        "3": {"name": "input_3_state", "unit": "bool", "source": "input:2", "field": "state"},
        "4": {"name": "input_4_state", "unit": "bool", "source": "input:3", "field": "state"}
    }',
    '{"channels": 4}',
    '{}',
    20
)
ON CONFLICT ON CONSTRAINT uq_device_template_name DO NOTHING;
