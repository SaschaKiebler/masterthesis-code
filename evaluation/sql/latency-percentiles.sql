-- QS-PER-01 / QS-PER-02: ingest latency percentiles.
--
-- Two different measures, do not mix them up in the protocol:
--
--   ingest      = persisted_at - received_at
--                 System entry to persistence. This is the response measure
--                 of QS-PER-01 ("p95 Eingang bis Persistierung unter 500 ms")
--                 and the recovery measure of QS-PER-02. Both timestamps are
--                 server-side (ingestion pod and database pod), so only the
--                 small intra-cluster clock offset applies.
--
--   end_to_end  = persisted_at - time
--                 Device clock to persistence, i.e. including MQTT transport.
--                 Only meaningful where the payload carries its own clock: the
--                 boiler (generic route) and Tasmota do, Shelly's per-component
--                 status payloads do not, so their `time` IS the receive time
--                 and end_to_end would collapse onto ingest. The query
--                 therefore reports it separately per device family.
--                 It is an UPPER BOUND: the generator stamps at tick time, so
--                 its own send queue delay is included (see P0.1b).
--
-- Usage (psql against the MEASUREMENT store):
--   psql -U postgres -d heating_platform_measurements \
--     -v start="'2026-08-11 10:00:00+02'" -v end="'2026-08-11 10:30:00+02'" \
--     -f evaluation/sql/latency-percentiles.sql

\echo '── Ingest latency, system entry to persistence (the response measure) ──'
SELECT count(*) AS samples,
       round((percentile_cont(0.50) WITHIN GROUP (
           ORDER BY EXTRACT(EPOCH FROM persisted_at - received_at) * 1000))::numeric, 1) AS p50_ms,
       round((percentile_cont(0.95) WITHIN GROUP (
           ORDER BY EXTRACT(EPOCH FROM persisted_at - received_at) * 1000))::numeric, 1) AS p95_ms,
       round((percentile_cont(0.99) WITHIN GROUP (
           ORDER BY EXTRACT(EPOCH FROM persisted_at - received_at) * 1000))::numeric, 1) AS p99_ms,
       round((max(EXTRACT(EPOCH FROM persisted_at - received_at)) * 1000)::numeric, 1)   AS max_ms
FROM measurements
WHERE received_at >= :start::timestamptz
  AND received_at <  :end::timestamptz
  AND received_at IS NOT NULL;

\echo '── Ingest latency per minute (QS-PER-02: recovery after the spike) ─────'
-- QS-PER-02 asks how long p95 stays above the target after the spike ends.
-- Read this column downwards and note the first minute back under the target.
SELECT date_trunc('minute', received_at) AS minute,
       count(*)                          AS samples,
       round((percentile_cont(0.95) WITHIN GROUP (
           ORDER BY EXTRACT(EPOCH FROM persisted_at - received_at) * 1000))::numeric, 1) AS p95_ms
FROM measurements
WHERE received_at >= :start::timestamptz
  AND received_at <  :end::timestamptz
  AND received_at IS NOT NULL
GROUP BY 1 ORDER BY 1;

\echo '── End to end incl. transport, only where a device clock exists ────────'
-- Rows whose time equals received_at have no device clock (Shelly route);
-- they are excluded so the number is not diluted by a tautology.
SELECT CASE WHEN device_id LIKE '%boiler%' THEN 'boiler (device clock)'
            ELSE 'other' END AS family,
       count(*) AS samples,
       round((percentile_cont(0.50) WITHIN GROUP (
           ORDER BY EXTRACT(EPOCH FROM persisted_at - time) * 1000))::numeric, 1) AS p50_ms,
       round((percentile_cont(0.95) WITHIN GROUP (
           ORDER BY EXTRACT(EPOCH FROM persisted_at - time) * 1000))::numeric, 1) AS p95_ms
FROM measurements
WHERE received_at >= :start::timestamptz
  AND received_at <  :end::timestamptz
  AND received_at IS NOT NULL
  AND time <> received_at          -- payload actually carried a clock
GROUP BY 1 ORDER BY 1;

\echo '── Coverage: how many rows carry a device clock at all ─────────────────'
-- Feeds the 6.2 statement about which share of the fleet supports the
-- end-to-end figure.
SELECT count(*) FILTER (WHERE time <> received_at) AS with_device_clock,
       count(*) FILTER (WHERE time =  received_at) AS receive_time_fallback,
       count(*) FILTER (WHERE received_at IS NULL) AS pre_instrumentation,
       count(*)                                    AS total
FROM measurements
WHERE persisted_at >= :start::timestamptz
  AND persisted_at <  :end::timestamptz;
