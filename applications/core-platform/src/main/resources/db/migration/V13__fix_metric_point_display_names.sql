-- V13: Reconstruct descriptive display_names for metric_points that were stored with
-- the ambiguous "Quantity Display (deviceId)" pattern (e.g. "Active Power (shellypro3em-...)").
-- Looks up the original signal map entry name from device_templates.default_signal_map
-- by matching on metric_id. This restores names like "phase_a_active_power" so that
-- phase-level metrics are distinguishable in the UI.
--
-- Operator notes:
--   -> returns jsonb (sub-object lookup by key)
--   ->> returns text (text-value extraction from jsonb)
-- We use -> first to get the jsonb entry, then ->>'name' to extract the name string.

UPDATE objects o
SET display_name = subq.original_name
FROM (
    SELECT
        mp.id,
        (
            SELECT (dt.default_signal_map->(mp.metric_id::int::text))->>'name'
            FROM device_templates dt
            WHERE (dt.default_signal_map->(mp.metric_id::int::text)) IS NOT NULL
              AND (dt.default_signal_map->(mp.metric_id::int::text))->>'name' IS NOT NULL
            ORDER BY dt.sort_order
            LIMIT 1
        ) AS original_name
    FROM metric_points mp
) subq
WHERE o.id = subq.id
  AND subq.original_name IS NOT NULL;
