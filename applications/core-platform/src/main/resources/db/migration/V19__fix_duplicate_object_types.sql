-- V19: Fix duplicate system object types
--
-- Two sets of system types (tenant_id IS NULL) exist with overlapping names:
--   - Legacy set with UUIDs starting 10000000-... (pre-migration seed)
--   - Canonical set with UUIDs starting a0000000-... (Flyway V3-V10 seeds)
-- For duplicated names (e.g. HEAT_METER, GATEWAY, CONTROLLER), the query
-- `findSystemTypeByName` fails with "2 results returned".
--
-- Strategy:
--   1. Re-point any objects referencing the legacy duplicate to the canonical row
--   2. Delete the legacy duplicate rows
--   3. Add a partial unique index to prevent future duplicates

-- Step 1: For each duplicated name, migrate objects from the legacy type to the canonical type
UPDATE objects o
SET object_type_id = canon.id
FROM object_types canon
JOIN object_types legacy ON canon.name = legacy.name
    AND canon.tenant_id IS NULL AND legacy.tenant_id IS NULL
    AND canon.id <> legacy.id
    AND canon.id::text LIKE 'a0000000-%'
    AND NOT legacy.id::text LIKE 'a0000000-%'
WHERE o.object_type_id = legacy.id;

-- Step 2: Also update device_templates referencing legacy duplicates
UPDATE device_templates dt
SET object_type_id = canon.id
FROM object_types canon
JOIN object_types legacy ON canon.name = legacy.name
    AND canon.tenant_id IS NULL AND legacy.tenant_id IS NULL
    AND canon.id <> legacy.id
    AND canon.id::text LIKE 'a0000000-%'
    AND NOT legacy.id::text LIKE 'a0000000-%'
WHERE dt.object_type_id = legacy.id;

-- Step 3: Delete the legacy duplicates (names that also exist in the a0000000-... set)
DELETE FROM object_types
WHERE tenant_id IS NULL
  AND NOT id::text LIKE 'a0000000-%'
  AND name IN (
    SELECT name FROM object_types
    WHERE tenant_id IS NULL AND id::text LIKE 'a0000000-%'
  );

-- Step 4: Partial unique index — prevents future duplicates for system types
CREATE UNIQUE INDEX IF NOT EXISTS uq_object_type_system_name
    ON object_types(name) WHERE tenant_id IS NULL;
