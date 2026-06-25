-- V11: ADR-013 Phase B — Migrate signal_map JSONB into first-class metric_points objects
--
-- For each asset with a non-empty signal_map, creates:
--   • An objects row  (object_type = METRIC_POINT)
--   • A metric_points extension row
--   • A HAS_METRIC link  (asset → metric_point)
--   • Optionally a MEASURES link (metric_point → physical_quantity) if name matches
--
-- Idempotent: the UNIQUE (device_id, metric_id) constraint on metric_points guards
-- against duplicate runs.  The inner CONTINUE skips already-migrated entries.
--
-- Depends on: V10 (metric_points / objects tables, METRIC_POINT type, HAS_METRIC / MEASURES links)
-- Must run BEFORE V12 (which drops assets.device_id and assets.signal_map).
-- Date: 2026-02-24
-- =====================================================================================

DO $$
DECLARE
    r_asset         RECORD;
    r_signal        RECORD;
    mp_uuid         UUID;
    display_nm      TEXT;
    q_id            UUID;
    asset_tenant_id UUID;
BEGIN
    -- ---------------------------------------------------------------------------------
    -- Iterate over every asset that carries a non-empty signal_map.
    -- ---------------------------------------------------------------------------------
    FOR r_asset IN
        SELECT a.id,
               a.device_id,
               a.signal_map
        FROM   assets a
        WHERE  a.device_id  IS NOT NULL
          AND  a.signal_map IS NOT NULL
          AND  a.signal_map != '{}'::jsonb
    LOOP
        -- Resolve tenant from the objects super-table (backfilled in V5 section 4c).
        SELECT o.tenant_id
        INTO   asset_tenant_id
        FROM   objects o
        WHERE  o.id = r_asset.id;

        -- -----------------------------------------------------------------
        -- Iterate over each (metric_key → signal_json) entry in signal_map.
        -- -----------------------------------------------------------------
        FOR r_signal IN
            SELECT key   AS metric_key,
                   value AS signal_json
            FROM   jsonb_each(r_asset.signal_map)
        LOOP
            -- Skip if this (device_id, metric_id) already exists → idempotent.
            IF EXISTS (
                SELECT 1
                FROM   metric_points mp
                WHERE  mp.device_id = r_asset.device_id
                  AND  mp.metric_id = r_signal.metric_key::smallint
            ) THEN
                CONTINUE;
            END IF;

            -- Generate a fresh UUID for the metric_point object.
            mp_uuid    := uuid_generate_v4();

            -- Derive a human-readable display_name from the signal's 'name' field.
            display_nm := COALESCE(
                r_signal.signal_json->>'name',
                'Metric ' || r_signal.metric_key
            );

            -- ----------------------------------------------------------------
            -- 1. Register metric_point in the universal objects super-table.
            -- ----------------------------------------------------------------
            INSERT INTO objects (id, object_type_id, tenant_id, display_name, created_at, updated_at)
            VALUES (
                mp_uuid,
                'a0000000-0000-0000-0000-000000000021',   -- METRIC_POINT
                asset_tenant_id,
                display_nm,
                NOW(),
                NOW()
            );

            -- ----------------------------------------------------------------
            -- 2. Insert the metric_points extension row.
            --    Cast min/max carefully: NULLIF guards against empty strings.
            -- ----------------------------------------------------------------
            INSERT INTO metric_points (
                id, device_id, metric_id,
                source, field, unit,
                min_value, max_value
            )
            VALUES (
                mp_uuid,
                r_asset.device_id,
                r_signal.metric_key::smallint,
                r_signal.signal_json->>'source',
                r_signal.signal_json->>'field',
                COALESCE(r_signal.signal_json->>'unit', ''),
                NULLIF(r_signal.signal_json->>'min', '')::double precision,
                NULLIF(r_signal.signal_json->>'max', '')::double precision
            );

            -- ----------------------------------------------------------------
            -- 3. Create HAS_METRIC link: asset → metric_point.
            --    Guard with objects existence check (asset must be in objects
            --    from V5 backfill; skip silently if somehow absent).
            -- ----------------------------------------------------------------
            IF EXISTS (SELECT 1 FROM objects WHERE id = r_asset.id) THEN
                INSERT INTO links (link_type_id, source_object_id, target_object_id)
                VALUES (
                    'c0000000-0000-0000-0000-000000000015',   -- HAS_METRIC
                    r_asset.id,
                    mp_uuid
                )
                ON CONFLICT ON CONSTRAINT uq_link DO NOTHING;
            END IF;

            -- ----------------------------------------------------------------
            -- 4. Try to resolve a matching physical_quantity by name.
            --    physical_quantities.name is snake_case (e.g. 'flow_temperature').
            --    The signal display_nm may already be snake_case, or be a title
            --    like 'Flow Temperature' — normalise both ways.
            -- ----------------------------------------------------------------
            SELECT pq.id
            INTO   q_id
            FROM   physical_quantities pq
            WHERE  pq.name = lower(display_nm)
               OR  pq.name = lower(replace(display_nm, ' ', '_'))
            LIMIT  1;

            IF q_id IS NOT NULL THEN
                -- Link the metric_point to its physical quantity.
                UPDATE metric_points
                SET    quantity_id = q_id
                WHERE  id = mp_uuid;

                -- Create MEASURES link: metric_point → physical_quantity.
                INSERT INTO links (link_type_id, source_object_id, target_object_id)
                VALUES (
                    'c0000000-0000-0000-0000-000000000013',   -- MEASURES
                    mp_uuid,
                    q_id
                )
                ON CONFLICT ON CONSTRAINT uq_link DO NOTHING;
            END IF;

        END LOOP;   -- end signal loop
    END LOOP;       -- end asset loop
END;
$$;
