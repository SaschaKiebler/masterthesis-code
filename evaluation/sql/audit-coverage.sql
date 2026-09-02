-- QS-SEC-01, second response measure: "je Versuch genau 1 Audit-Eintrag".
--
-- Runs against the MASTER-DATA store after a security run. The window comes
-- from the runner as :start / :end, the same window the locust run covered.
--
-- Usage (psql against digital_demon):
--   kubectl -n heating-platform exec -i stammdaten-db-0 -- \
--     psql -U postgres -d digital_demon \
--     -v start="'2026-09-02 16:00:00+00'" -v end="'2026-09-02 16:10:00+00'" \
--     -f - < evaluation/sql/audit-coverage.sql
--
-- How to read it, and this belongs in ch. 6.3.1 rather than in a footnote:
-- not every attempt can produce a row, and that is by design. The filter
-- records an attempt when it can name the tenant the request addressed. A
-- collection endpoint such as /api/v1/projects names no tenant at all, it
-- simply narrows its query, so it leaves no row. Section 4 below separates
-- those two populations instead of reporting one ratio over everything.

\echo '── 1. Audit rows in the window, by outcome ─────────────────────────────'
SELECT outcome, count(*) AS rows
FROM access_audit
WHERE occurred_at >= :start::timestamptz AND occurred_at < :end::timestamptz
GROUP BY outcome
ORDER BY 2 DESC;

\echo '── 2. By subject: who was recorded (the attacker must appear) ──────────'
SELECT subject, outcome, count(*) AS rows
FROM access_audit
WHERE occurred_at >= :start::timestamptz AND occurred_at < :end::timestamptz
GROUP BY subject, outcome
ORDER BY 3 DESC
LIMIT 20;

\echo '── 3. By endpoint, most recorded first (the coverage map) ──────────────'
SELECT method,
       regexp_replace(path, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '{id}', 'g') AS route,
       outcome,
       count(*) AS rows
FROM access_audit
WHERE occurred_at >= :start::timestamptz AND occurred_at < :end::timestamptz
GROUP BY 1, 2, 3
ORDER BY 4 DESC
LIMIT 40;

\echo '── 4. Which service recorded it (core filter vs. analytics dependency) ─'
SELECT CASE WHEN path LIKE '/stats/%' THEN 'analytics' ELSE 'core' END AS recorded_by,
       outcome,
       count(*) AS rows
FROM access_audit
WHERE occurred_at >= :start::timestamptz AND occurred_at < :end::timestamptz
GROUP BY 1, 2
ORDER BY 3 DESC;

\echo '── 5. Sanity: rows naming a tenant vs. rows naming none ────────────────'
SELECT (requested_tenant IS NOT NULL) AS names_a_tenant, count(*) AS rows
FROM access_audit
WHERE occurred_at >= :start::timestamptz AND occurred_at < :end::timestamptz
GROUP BY 1;
