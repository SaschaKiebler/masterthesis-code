-- V12: ADR-013 Phase E — Drop legacy columns from assets table
--
-- These columns are fully superseded by the ontology layer:
--   device_id   → now on physical_devices + metric_points (first-class objects)
--   type        → now expressed as object_type_id in the objects table (backfilled in V5)
--   model_human → now on physical_devices.model
--   signal_map  → migrated to metric_points objects in V11
--   secrets     → migrated to physical_devices.secrets in V11 / V10
--
-- Must run AFTER V11 (Phase B) so signal_map data is preserved before columns are dropped.
-- Date: 2026-02-24
-- =====================================================================================

-- 1. Drop the index on device_id first (required before the column can be dropped).
DROP INDEX IF EXISTS idx_assets_device_id;

-- 2. Drop the UNIQUE constraint on device_id (was NOT NULL UNIQUE in schema.sql).
ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_device_id_key;

-- 3. Drop legacy columns.
ALTER TABLE assets
    DROP COLUMN IF EXISTS device_id,
    DROP COLUMN IF EXISTS type,
    DROP COLUMN IF EXISTS model_human,
    DROP COLUMN IF EXISTS signal_map,
    DROP COLUMN IF EXISTS secrets;
