-- Upgrade for measurement stores that were initialised before the ingest
-- timestamps existed.
--
-- The init scripts in ../init/ only run on a *fresh* volume, and `dev.sh down`
-- keeps the volume. An existing local database therefore never sees the new
-- columns, and ingestion would fail every INSERT with
--   column "received_at" of relation "measurements" does not exist
-- Apply this once, or wipe the volume instead:
--   docker compose -f docker/docker-compose-kafka.yaml down -v
--
-- Usage:
--   docker compose -f docker/docker-compose-kafka.yaml exec -T measurement-db \
--     psql -U postgres -d heating_platform_measurements \
--     < docker/measurement-db/upgrade/001_add_ingest_timestamps.sql
--
-- The GKE evaluation environment does not need this: terraform apply creates a
-- fresh PVC, so the ConfigMap DDL in
-- infrastructure/kubernetes/base/measurement-db.yaml applies as-is.
--
-- Idempotent, safe to re-run. received_at stays NULL for rows written before
-- the instrumentation; backfilling them would assert a receive time that was
-- never observed, so evaluation queries must filter on received_at IS NOT NULL.

ALTER TABLE measurements
    ADD COLUMN IF NOT EXISTS received_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS persisted_at TIMESTAMPTZ NOT NULL DEFAULT now();
