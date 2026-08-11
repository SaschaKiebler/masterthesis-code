-- QS-PER-01 / QS-PER-02: loss rate of the ingest chain.
--
-- The database only knows what arrived. The generator side of the comparison
-- comes from mock-service's stats line ("published=… msg/s queue=… dropped=…"),
-- which counts MESSAGES; the scenarios are specified in MEASUREMENTS per
-- second, and one boiler message carries several metrics while one Shelly
-- message carries exactly one. Note both numbers in the run protocol and
-- convert before computing a rate — see P0.6 in the evaluation plan.
--
--   loss rate = 1 - (persisted measurements / published measurements)
--
-- Usage (psql against the MEASUREMENT store):
--   psql -U postgres -d digital_demon_measurements \
--     -v start="'2026-08-11 10:00:00+02'" -v end="'2026-08-11 10:30:00+02'" \
--     -f evaluation/sql/loss-rate.sql
--
-- The window is filtered on received_at (system entry), not on time: a device
-- clock could otherwise pull rows out of the window that the platform did
-- accept during it.

\echo '── Persisted measurements in the window ────────────────────────────────'
SELECT count(*)                       AS persisted_measurements,
       count(DISTINCT device_id)      AS devices,
       min(received_at)               AS first_received,
       max(received_at)               AS last_received,
       round(count(*)::numeric
             / NULLIF(EXTRACT(EPOCH FROM max(received_at) - min(received_at)), 0), 1)
                                      AS measurements_per_second
FROM measurements
WHERE received_at >= :start::timestamptz
  AND received_at <  :end::timestamptz;

\echo '── Per device family (boiler vs. Shelly carry different metric counts) ─'
SELECT CASE WHEN device_id LIKE '%boiler%' THEN 'boiler' ELSE 'sensor' END AS family,
       count(*)                  AS measurements,
       count(DISTINCT device_id) AS devices
FROM measurements
WHERE received_at >= :start::timestamptz
  AND received_at <  :end::timestamptz
GROUP BY 1 ORDER BY 1;

\echo '── Rejected payloads (parse/route failures, NOT silent loss) ───────────'
-- Rows here mean the platform saw the message and refused it on purpose.
-- They belong in the protocol separately from loss: nothing vanished silently.
SELECT count(*) AS ingestion_errors,
       min(created_at) AS first_error,
       max(created_at) AS last_error
FROM ingestion_errors
WHERE created_at >= :start::timestamptz
  AND created_at <  :end::timestamptz;

\echo '── Error reasons, most frequent first ──────────────────────────────────'
SELECT error_message, count(*) AS occurrences
FROM ingestion_errors
WHERE created_at >= :start::timestamptz
  AND created_at <  :end::timestamptz
GROUP BY error_message
ORDER BY occurrences DESC
LIMIT 10;

\echo '── Per-minute arrival profile (spot the spike and the recovery) ────────'
-- QS-PER-02 reads this: the spike minute should show ~5x the base rate and no
-- gap afterwards. A dip AFTER the spike would indicate the platform shed load.
SELECT date_trunc('minute', received_at) AS minute,
       count(*)                          AS measurements
FROM measurements
WHERE received_at >= :start::timestamptz
  AND received_at <  :end::timestamptz
GROUP BY 1 ORDER BY 1;
