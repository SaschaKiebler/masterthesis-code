-- Seed hand-crafted P&ID-style SVG icons for system default object types.
-- These are inline data URIs so they work without GCS.
-- Stroke color: #94a3b8 (slate-400), stroke-width: 2, viewBox: 0 0 80 80

-- BUILDING — house outline
UPDATE object_types SET svg_icon_url = 'data:image/svg+xml;base64,' || encode(convert_to(
'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 68V36L40 12l28 24v32H12z"/><rect x="30" y="46" width="20" height="22"/><line x1="40" y1="46" x2="40" y2="68"/><rect x="22" y="38" width="10" height="10"/><rect x="48" y="38" width="10" height="10"/></svg>'
, 'UTF8'), 'base64')
WHERE name = 'BUILDING' AND tenant_id IS NULL;

-- FLOOR — stacked layers
UPDATE object_types SET svg_icon_url = 'data:image/svg+xml;base64,' || encode(convert_to(
'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="12" y="14" width="56" height="14" rx="2"/><rect x="12" y="33" width="56" height="14" rx="2"/><rect x="12" y="52" width="56" height="14" rx="2"/></svg>'
, 'UTF8'), 'base64')
WHERE name = 'FLOOR' AND tenant_id IS NULL;

-- APARTMENT — door with handle
UPDATE object_types SET svg_icon_url = 'data:image/svg+xml;base64,' || encode(convert_to(
'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="16" y="10" width="48" height="60" rx="3"/><rect x="24" y="18" width="14" height="12" rx="1"/><rect x="42" y="18" width="14" height="12" rx="1"/><rect x="30" y="42" width="20" height="28"/><circle cx="46" cy="56" r="2"/></svg>'
, 'UTF8'), 'base64')
WHERE name = 'APARTMENT' AND tenant_id IS NULL;

-- ROOM — simple rectangle with door gap
UPDATE object_types SET svg_icon_url = 'data:image/svg+xml;base64,' || encode(convert_to(
'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="12" y="12" width="56" height="56" rx="2"/><line x1="12" y1="56" x2="28" y2="56"/><line x1="40" y1="56" x2="68" y2="56"/><path d="M28 56 Q28 44 38 44"/></svg>'
, 'UTF8'), 'base64')
WHERE name = 'ROOM' AND tenant_id IS NULL;

-- TECHNICAL_ROOM — room with gear
UPDATE object_types SET svg_icon_url = 'data:image/svg+xml;base64,' || encode(convert_to(
'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="12" y="12" width="56" height="56" rx="2"/><circle cx="40" cy="40" r="10"/><circle cx="40" cy="40" r="4"/><line x1="40" y1="26" x2="40" y2="30"/><line x1="40" y1="50" x2="40" y2="54"/><line x1="26" y1="40" x2="30" y2="40"/><line x1="50" y1="40" x2="54" y2="40"/><line x1="30" y1="30" x2="33" y2="33"/><line x1="47" y1="47" x2="50" y2="50"/><line x1="30" y1="50" x2="33" y2="47"/><line x1="47" y1="33" x2="50" y2="30"/></svg>'
, 'UTF8'), 'base64')
WHERE name = 'TECHNICAL_ROOM' AND tenant_id IS NULL;

-- BOILER — P&ID: rectangle with flame
UPDATE object_types SET svg_icon_url = 'data:image/svg+xml;base64,' || encode(convert_to(
'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="14" y="14" width="52" height="52" rx="4"/><path d="M30 58 Q32 44 36 48 Q38 38 40 42 Q42 32 44 42 Q46 38 48 48 Q52 44 50 58" stroke="#f59e0b" stroke-width="2.5"/><line x1="14" y1="30" x2="8" y2="30"/><line x1="66" y1="30" x2="72" y2="30"/><line x1="14" y1="50" x2="8" y2="50"/><line x1="66" y1="50" x2="72" y2="50"/></svg>'
, 'UTF8'), 'base64')
WHERE name = 'BOILER' AND tenant_id IS NULL;

-- PUMP — P&ID: circle with triangle
UPDATE object_types SET svg_icon_url = 'data:image/svg+xml;base64,' || encode(convert_to(
'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="40" cy="40" r="24"/><polygon points="28,28 28,52 56,40"/><line x1="8" y1="40" x2="16" y2="40"/><line x1="64" y1="40" x2="72" y2="40"/></svg>'
, 'UTF8'), 'base64')
WHERE name = 'PUMP' AND tenant_id IS NULL;

-- HEAT_METER — P&ID: circle with Q
UPDATE object_types SET svg_icon_url = 'data:image/svg+xml;base64,' || encode(convert_to(
'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="40" cy="40" r="24"/><circle cx="40" cy="37" r="10"/><line x1="46" y1="43" x2="54" y2="51"/><line x1="8" y1="40" x2="16" y2="40"/><line x1="64" y1="40" x2="72" y2="40"/></svg>'
, 'UTF8'), 'base64')
WHERE name = 'HEAT_METER' AND tenant_id IS NULL;

-- ENERGY_METER — P&ID: circle with lightning bolt
UPDATE object_types SET svg_icon_url = 'data:image/svg+xml;base64,' || encode(convert_to(
'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="40" cy="40" r="24"/><polyline points="44,24 34,42 44,42 36,56" stroke-width="2.5"/><line x1="8" y1="40" x2="16" y2="40"/><line x1="64" y1="40" x2="72" y2="40"/></svg>'
, 'UTF8'), 'base64')
WHERE name = 'ENERGY_METER' AND tenant_id IS NULL;

-- GENERIC_SENSOR — P&ID: circle with T (temperature)
UPDATE object_types SET svg_icon_url = 'data:image/svg+xml;base64,' || encode(convert_to(
'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="40" cy="40" r="24"/><line x1="30" y1="30" x2="50" y2="30"/><line x1="40" y1="30" x2="40" y2="52"/><line x1="8" y1="40" x2="16" y2="40"/><line x1="64" y1="40" x2="72" y2="40"/></svg>'
, 'UTF8'), 'base64')
WHERE name = 'GENERIC_SENSOR' AND tenant_id IS NULL;

-- HEATING_CIRCUIT — two parallel pipes with flow arrows
UPDATE object_types SET svg_icon_url = 'data:image/svg+xml;base64,' || encode(convert_to(
'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="28" x2="72" y2="28" stroke="#ef4444"/><line x1="8" y1="52" x2="72" y2="52" stroke="#3b82f6"/><polyline points="56,22 64,28 56,34" stroke="#ef4444"/><polyline points="24,46 16,52 24,58" stroke="#3b82f6"/><path d="M72 28 Q76 40 72 52"/><path d="M8 28 Q4 40 8 52"/></svg>'
, 'UTF8'), 'base64')
WHERE name = 'HEATING_CIRCUIT' AND tenant_id IS NULL;

-- HEATING_ZONE — dashed rectangle with thermometer
UPDATE object_types SET svg_icon_url = 'data:image/svg+xml;base64,' || encode(convert_to(
'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="12" y="12" width="56" height="56" rx="4" stroke-dasharray="6 4"/><rect x="36" y="22" width="8" height="28" rx="4"/><circle cx="40" cy="54" r="6"/><line x1="40" y1="36" x2="40" y2="50"/></svg>'
, 'UTF8'), 'base64')
WHERE name = 'HEATING_ZONE' AND tenant_id IS NULL;

-- DISTRIBUTION_NETWORK — manifold/header bar with branches
UPDATE object_types SET svg_icon_url = 'data:image/svg+xml;base64,' || encode(convert_to(
'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="32" width="64" height="16" rx="3"/><line x1="20" y1="32" x2="20" y2="16"/><line x1="40" y1="32" x2="40" y2="16"/><line x1="60" y1="32" x2="60" y2="16"/><line x1="20" y1="48" x2="20" y2="64"/><line x1="40" y1="48" x2="40" y2="64"/><line x1="60" y1="48" x2="60" y2="64"/></svg>'
, 'UTF8'), 'base64')
WHERE name = 'DISTRIBUTION_NETWORK' AND tenant_id IS NULL;

-- ACTUATOR — P&ID: valve symbol (bowtie)
UPDATE object_types SET svg_icon_url = 'data:image/svg+xml;base64,' || encode(convert_to(
'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="16,28 40,40 16,52"/><polygon points="64,28 40,40 64,52"/><line x1="40" y1="40" x2="40" y2="16"/><rect x="30" y="10" width="20" height="10" rx="2"/><line x1="8" y1="40" x2="16" y2="40"/><line x1="64" y1="40" x2="72" y2="40"/></svg>'
, 'UTF8'), 'base64')
WHERE name = 'ACTUATOR' AND tenant_id IS NULL;

-- CONTROLLER — rectangle with C label represented as control symbol
UPDATE object_types SET svg_icon_url = 'data:image/svg+xml;base64,' || encode(convert_to(
'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="14" y="18" width="52" height="44" rx="4"/><circle cx="40" cy="40" r="12"/><path d="M46 34 Q34 34 34 40 Q34 46 46 46"/><line x1="14" y1="40" x2="8" y2="40"/><line x1="66" y1="40" x2="72" y2="40"/><line x1="40" y1="18" x2="40" y2="12"/></svg>'
, 'UTF8'), 'base64')
WHERE name = 'CONTROLLER' AND tenant_id IS NULL;

-- GATEWAY — rectangle with antenna
UPDATE object_types SET svg_icon_url = 'data:image/svg+xml;base64,' || encode(convert_to(
'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="18" y="34" width="44" height="34" rx="4"/><line x1="40" y1="34" x2="40" y2="16"/><path d="M30 22 Q40 10 50 22"/><path d="M34 26 Q40 18 46 26"/><circle cx="28" cy="48" r="3"/><circle cx="40" cy="48" r="3"/><circle cx="52" cy="48" r="3"/></svg>'
, 'UTF8'), 'base64')
WHERE name = 'GATEWAY' AND tenant_id IS NULL;
