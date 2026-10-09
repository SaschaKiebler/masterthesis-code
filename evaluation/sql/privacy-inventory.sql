-- QS-SEC-02 reference inventory: everything the platform holds about ONE data
-- subject (a PERSON object) BEFORE export and erasure. This is the target list
-- the export has to cover completely (response measure "Export deckt 100 %
-- des Referenzinventars ab").
--
-- The walk mirrors PersonPrivacyService.reachableDevices on purpose, but it
-- is written independently in SQL so that the export is checked against the
-- data and not against its own implementation:
--   PERSON -RESIDES_IN-> space -CONTAINS*-> space <-INSTALLED_IN- asset
--   asset -REALIZED_BY-> physical_devices.device_id
--   asset -HAS_METRIC->  metric_points.device_id
-- Both device resolutions are kept, as in the service, because either alone
-- can miss a device family.
--
-- Usage (psql against the MASTER-DATA store):
--   docker compose -f docker/docker-compose-kafka.yaml exec -T stammdaten-db \
--     psql -U postgres -d heating_platform \
--     -v subject_id="'<person-object-uuid>'" \
--     -f - < evaluation/sql/privacy-inventory.sql
--
-- The measurement rows per device live in the OTHER store; count them there:
--   SELECT device_id, count(*) FROM measurements
--   WHERE device_id IN ('<ids from section 4>') GROUP BY 1;
-- evaluation/scripts/qs_sec_02_privacy_run.py does both and compares.

\echo '── 1. The person object (display_name and properties must appear in the export)'
SELECT o.id, o.display_name, o.tenant_id, o.properties
FROM objects o
JOIN object_types t ON t.id = o.object_type_id
WHERE o.id = :subject_id::uuid AND t.name = 'PERSON';

\echo '── 2. Residences (RESIDES_IN targets, must appear as export.residences)'
SELECT l.target_object_id AS space_id, s.display_name, st.name AS space_type
FROM links l
JOIN link_types lt ON lt.id = l.link_type_id AND lt.name = 'RESIDES_IN'
JOIN objects s ON s.id = l.target_object_id
JOIN object_types st ON st.id = s.object_type_id
WHERE l.source_object_id = :subject_id::uuid
ORDER BY 2;

\echo '── 3. All links touching the person (cascade away on erasure)'
SELECT count(*) AS links_total
FROM links
WHERE source_object_id = :subject_id::uuid OR target_object_id = :subject_id::uuid;

\echo '── 4. Devices reachable through the graph (must appear as export.devices)'
WITH RECURSIVE
lt AS (
    SELECT name, id FROM link_types
    WHERE name IN ('RESIDES_IN', 'CONTAINS', 'INSTALLED_IN', 'REALIZED_BY', 'HAS_METRIC')
),
spaces AS (
    SELECT l.target_object_id AS id, 0 AS depth
    FROM links l JOIN lt ON lt.id = l.link_type_id AND lt.name = 'RESIDES_IN'
    WHERE l.source_object_id = :subject_id::uuid
    UNION
    SELECT l.target_object_id, s.depth + 1
    FROM spaces s
    JOIN links l ON l.source_object_id = s.id
    JOIN lt ON lt.id = l.link_type_id AND lt.name = 'CONTAINS'
    WHERE s.depth < 5
),
assets AS (
    SELECT DISTINCT l.source_object_id AS id
    FROM links l JOIN lt ON lt.id = l.link_type_id AND lt.name = 'INSTALLED_IN'
    WHERE l.target_object_id IN (SELECT id FROM spaces)
),
devices AS (
    SELECT pd.device_id, 'REALIZED_BY' AS via
    FROM links l
    JOIN lt ON lt.id = l.link_type_id AND lt.name = 'REALIZED_BY'
    JOIN physical_devices pd ON pd.id = l.target_object_id
    WHERE l.source_object_id IN (SELECT id FROM assets)
    UNION
    SELECT mp.device_id, 'HAS_METRIC'
    FROM links l
    JOIN lt ON lt.id = l.link_type_id AND lt.name = 'HAS_METRIC'
    JOIN metric_points mp ON mp.id = l.target_object_id
    WHERE l.source_object_id IN (SELECT id FROM assets)
)
SELECT device_id, string_agg(via, ',' ORDER BY via) AS resolved_via
FROM devices
GROUP BY device_id
ORDER BY device_id;

\echo '── 5. Derived properties on the person (must vanish on erasure)'
SELECT count(*) AS derived_properties
FROM derived_properties
WHERE object_id = :subject_id::uuid;
