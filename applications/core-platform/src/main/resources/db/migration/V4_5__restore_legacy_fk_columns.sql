-- Originally restored legacy FK columns on spaces/assets tables for V5 backfill.
-- Those tables were dropped in V8/V12/V14, so this migration is now a no-op.
-- Kept as an empty migration so Flyway records it as applied.
SELECT 1;
