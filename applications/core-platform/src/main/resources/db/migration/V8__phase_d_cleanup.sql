-- =====================================================================================
-- V8: ADR-011 Phase D — Drop legacy FK columns and deprecated relationships table.
--
-- All relationships are now managed exclusively via the links table.
-- The FK columns were dual-written during Phase A/B/C and are no longer read or written.
-- =====================================================================================

-- 1. Drop FK columns from assets
ALTER TABLE assets DROP COLUMN IF EXISTS site_id;
ALTER TABLE assets DROP COLUMN IF EXISTS space_id;

-- 2. Drop FK columns from spaces
ALTER TABLE spaces DROP COLUMN IF EXISTS site_id;
ALTER TABLE spaces DROP COLUMN IF EXISTS parent_space_id;

-- 3. Drop FK column from contacts
ALTER TABLE contacts DROP COLUMN IF EXISTS space_id;

-- 4. Drop the deprecated relationships table (superseded by links table)
DROP TABLE IF EXISTS relationships CASCADE;

-- 5. Drop orphaned indexes (if the column drop didn't cascade them)
DROP INDEX IF EXISTS idx_assets_site;
DROP INDEX IF EXISTS idx_assets_space;
DROP INDEX IF EXISTS idx_spaces_site;
DROP INDEX IF EXISTS idx_spaces_parent;
DROP INDEX IF EXISTS idx_relationships_source;
DROP INDEX IF EXISTS idx_relationships_target;
