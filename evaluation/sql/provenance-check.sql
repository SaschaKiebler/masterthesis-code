-- QS-INT-02: provenance of persisted measurements.
--
-- Response measure: "100 % der persistierten Werte tragen Gerät, Metrik, Mess-
-- und Empfangszeitpunkt, Stichprobe von 100 Werten bis zur Roh-Payload
-- rückverfolgbar."
--
-- Honest reading, to be stated in ch. 6.3.2 rather than glossed over: on the
-- Shelly route measurement time and receive time carry the SAME value,
-- because those payloads have no device clock (see P0.1b). The four fields are
-- present, but the two timestamps are not independent there. The last query
-- quantifies exactly that share instead of hiding it.
--
-- Usage (psql against the MEASUREMENT store):
--   psql -U postgres -d heating_platform_measurements \
--     -v start="'2026-08-11 10:00:00+02'" -v end="'2026-08-11 10:30:00+02'" \
--     -f evaluation/sql/provenance-check.sql

\echo '── Completeness of the four provenance fields (target: 0 missing) ──────'
SELECT count(*)                                          AS total,
       count(*) FILTER (WHERE device_id   IS NULL)       AS missing_device,
       count(*) FILTER (WHERE metric_id   IS NULL)       AS missing_metric,
       count(*) FILTER (WHERE time        IS NULL)       AS missing_measured_at,
       count(*) FILTER (WHERE received_at IS NULL)       AS missing_received_at,
       round(100.0 * count(*) FILTER (
           WHERE device_id IS NOT NULL AND metric_id IS NOT NULL
             AND time IS NOT NULL AND received_at IS NOT NULL
       ) / NULLIF(count(*), 0), 2)                       AS complete_percent
FROM measurements
WHERE received_at >= :start::timestamptz
  AND received_at <  :end::timestamptz;

\echo '── Every device resolves to a registered metric point (no orphans) ─────'
-- Cross-database check is not possible from here; this lists the distinct
-- (device_id, metric_id) pairs so they can be diffed against the registry
-- (core: GET /api/v1/projects/{id}/metric-points).
SELECT device_id, metric_id, count(*) AS measurements
FROM measurements
WHERE received_at >= :start::timestamptz
  AND received_at <  :end::timestamptz
GROUP BY device_id, metric_id
ORDER BY device_id, metric_id;

\echo '── Sample of 100 values for manual traceability to the raw payload ─────'
-- Deterministic sample (ordered, not random) so the protocol is reproducible.
-- Trace path per row: device_id + time → mock-service run log / MQTT topic →
-- ingestion log line → this row.
SELECT device_id, metric_id, value, time AS measured_at, received_at, persisted_at,
       round((EXTRACT(EPOCH FROM persisted_at - received_at) * 1000)::numeric, 1) AS ingest_ms
FROM measurements
WHERE received_at >= :start::timestamptz
  AND received_at <  :end::timestamptz
ORDER BY received_at, device_id, metric_id
LIMIT 100;

\echo '── Independence of the two timestamps (the honest caveat) ──────────────'
SELECT CASE WHEN time <> received_at THEN 'device clock (independent)'
            ELSE 'receive-time fallback (identical)' END AS timestamp_source,
       count(*) AS measurements,
       round(100.0 * count(*) / SUM(count(*)) OVER (), 2) AS percent
FROM measurements
WHERE received_at >= :start::timestamptz
  AND received_at <  :end::timestamptz
GROUP BY 1 ORDER BY 2 DESC;
