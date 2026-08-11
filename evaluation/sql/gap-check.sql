-- QS-INT-01: a sensor outage must stay visible as a gap.
--
-- Response measure: "Persistiert gleich empfangen (Verlustrate 0 %), 0 Daten-
-- punkte innerhalb der Lücke in Speicher und API-Antwort". This file covers
-- the storage half; the API half is checked by querying analytics
-- /stats/timeseries over the same window and confirming it returns null
-- buckets rather than interpolated values.
--
-- Produced by: mock-service run --fault dropout:count=1,at=<s>,for=<s>
-- The faulted device simply stops publishing, so a correct platform shows a
-- hole. A platform that back-fills or carries values forward would show none —
-- that is exactly the failure this scenario looks for.
--
-- Usage (psql against the MEASUREMENT store):
--   psql -U postgres -d digital_demon_measurements \
--     -v device="'mock-ht-001-01'" -v metric=1 \
--     -v start="'2026-08-11 10:00:00+02'" -v end="'2026-08-11 10:30:00+02'" \
--     -f evaluation/sql/gap-check.sql

\echo '── Series overview for the faulted channel ─────────────────────────────'
SELECT count(*)      AS measurements,
       min(time)     AS first_value,
       max(time)     AS last_value
FROM measurements
WHERE device_id = :device AND metric_id = :metric
  AND time >= :start::timestamptz AND time < :end::timestamptz;

\echo '── Detected gaps, largest first (a gap = interval > 3x the median) ─────'
-- The threshold is relative to the channel''s own cadence, so it works for any
-- --interval the run used without hardcoding it.
WITH ordered AS (
    SELECT time,
           time - lag(time) OVER (ORDER BY time) AS delta
    FROM measurements
    WHERE device_id = :device AND metric_id = :metric
      AND time >= :start::timestamptz AND time < :end::timestamptz
),
cadence AS (
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM delta)) AS median_s
    FROM ordered WHERE delta IS NOT NULL
)
SELECT o.time                                     AS gap_ends_at,
       o.time - o.delta                           AS gap_starts_at,
       round(EXTRACT(EPOCH FROM o.delta)::numeric, 1) AS gap_seconds,
       round(c.median_s::numeric, 1)              AS normal_cadence_seconds
FROM ordered o CROSS JOIN cadence c
WHERE o.delta IS NOT NULL
  AND EXTRACT(EPOCH FROM o.delta) > 3 * c.median_s
ORDER BY o.delta DESC;

\echo '── Values INSIDE the gap window (target: 0 rows) ───────────────────────'
-- Fill the two bounds from the gap detected above. Any row here means the
-- platform invented data — an outright QS-INT-01 failure.
-- Re-run with:  -v gap_start="'…'" -v gap_end="'…'"
\if :{?gap_start}
SELECT count(*) AS values_inside_gap
FROM measurements
WHERE device_id = :device AND metric_id = :metric
  AND time > :gap_start::timestamptz AND time < :gap_end::timestamptz;
\else
\echo '(skipped — pass -v gap_start=… -v gap_end=… from the gap found above)'
\endif

\echo '── Neighbouring channels kept reporting (isolates the fault) ───────────'
-- Confirms the gap is the simulated sensor outage and not a platform-wide
-- stall: other devices must show an unbroken series in the same window.
SELECT device_id, count(*) AS measurements, min(time) AS first_value, max(time) AS last_value
FROM measurements
WHERE metric_id = :metric AND device_id <> :device
  AND time >= :start::timestamptz AND time < :end::timestamptz
GROUP BY device_id ORDER BY device_id LIMIT 10;
