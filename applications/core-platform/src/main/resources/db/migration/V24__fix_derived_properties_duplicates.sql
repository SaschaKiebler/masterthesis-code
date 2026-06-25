-- Fix duplicate "current" rows in derived_properties.
-- The original unique constraint uq_derived_current(object_id, property_name, valid_until)
-- does not prevent duplicates when valid_until IS NULL because PostgreSQL treats NULLs
-- as distinct in unique constraints.
--
-- 1. Drop the ineffective constraint first (it blocks the cleanup UPDATE)
-- 2. Expire all but the newest current row per (object_id, property_name)
-- 3. Add a proper partial unique index that enforces at most one current row

-- Step 1: Drop the old constraint that doesn't prevent NULL duplicates
--         (must happen first, otherwise the UPDATE in step 2 violates it
--          when two rows get the same non-NULL valid_until timestamp)
ALTER TABLE derived_properties DROP CONSTRAINT IF EXISTS uq_derived_current;

-- Step 2: Expire duplicate current rows, keeping only the most recently computed one
UPDATE derived_properties dp
SET valid_until = NOW()
WHERE dp.valid_until IS NULL
  AND dp.id != (
      SELECT sub.id
      FROM derived_properties sub
      WHERE sub.object_id = dp.object_id
        AND sub.property_name = dp.property_name
        AND sub.valid_until IS NULL
      ORDER BY sub.computed_at DESC
      LIMIT 1
  );

-- Step 3: Add a partial unique index that actually enforces one current row per property
CREATE UNIQUE INDEX uq_derived_current_active
    ON derived_properties (object_id, property_name)
    WHERE valid_until IS NULL;
