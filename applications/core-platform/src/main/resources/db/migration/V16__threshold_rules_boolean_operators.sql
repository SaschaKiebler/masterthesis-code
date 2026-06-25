-- V16: Extend threshold_rules to support boolean state-change operators.
-- Adds CHANGED_TO_TRUE and CHANGED_TO_FALSE to the valid operator set.
-- threshold column is nullable for change-detection rules (no numeric threshold needed).

-- 1. Drop the existing CHECK constraint (PostgreSQL requires drop + re-add)
ALTER TABLE threshold_rules DROP CONSTRAINT IF EXISTS threshold_rules_operator_check;

-- 2. Add the expanded operator set
ALTER TABLE threshold_rules ADD CONSTRAINT threshold_rules_operator_check
    CHECK (operator IN ('GT', 'LT', 'GTE', 'LTE', 'CHANGED_TO_TRUE', 'CHANGED_TO_FALSE'));

-- 3. Make threshold nullable — state-change rules don't use a numeric threshold
ALTER TABLE threshold_rules ALTER COLUMN threshold DROP NOT NULL;
