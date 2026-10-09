-- QS-SEC-02 residual check: after a GDPR erasure run, no trace of the data
-- subject may remain in the master-data database — except the documented
-- exceptions listed at the bottom.
--
-- Usage (psql against the master-data DB, e.g. via docker compose):
--   psql -U postgres -d heating_platform \
--     -v subject_name="Mock Person 001-01" \
--     -v subject_email="person-001-01@mock.example.org" \
--     -v subject_id="'<person-object-uuid>'" \
--     -f evaluation/sql/privacy-residual-check.sql
--
-- Expected result after a complete erasure: every SELECT below returns 0 rows.
-- Any hit is a finding for ch. 6.3.1 (first measurement, fix, re-measure).

\echo '── 1. PERSON object itself ─────────────────────────────────────────────'
SELECT id, display_name FROM objects WHERE id = :subject_id::uuid;

\echo '── 2. Clear-text name anywhere in objects ──────────────────────────────'
SELECT id, display_name FROM objects WHERE display_name = :'subject_name';

\echo '── 3. Contact data in object properties ────────────────────────────────'
SELECT id, display_name, properties
FROM objects
WHERE properties::text ILIKE '%' || :'subject_email' || '%';

\echo '── 4. Links from or to the person (should have cascaded) ───────────────'
SELECT l.id, lt.name AS link_type
FROM links l JOIN link_types lt ON lt.id = l.link_type_id
WHERE l.source_object_id = :subject_id::uuid OR l.target_object_id = :subject_id::uuid;

\echo '── 5. Platform-user traces (only relevant for user erasure runs) ───────'
SELECT id, email FROM users WHERE email = :'subject_email';
SELECT id, email FROM invitations WHERE email = :'subject_email';

\echo '── 6. Derived properties written onto the person object ────────────────'
SELECT id, property_name FROM derived_properties WHERE object_id = :subject_id::uuid;

-- ── Documented exceptions (checked, but their hits are EXPECTED) ────────────
--
-- access_audit: retained for security accountability (UC-BET-05). After user
-- erasure the subject string no longer resolves to a person. Count is reported,
-- not treated as a failure:
\echo '── E1. access_audit entries (EXPECTED to remain for user subjects) ─────'
SELECT count(*) AS retained_audit_entries
FROM access_audit
WHERE user_id = :subject_id::uuid;

-- measurements (in the measurement DB, not checked here): retained unchanged
-- by design — severing the RESIDES_IN link removed the subject reference
-- (Art. 17(3)(b) retention of billing-relevant readings, QS-INT raw-data
-- integrity). The erasure report lists the affected device ids and row counts.
--
-- UUID residuals invited_by / assigned_by / created_by: unresolvable after the
-- user row is gone; documented in ch. 6.3.1 as pseudonymous leftovers.
