-- Access audit trail for cross-tenant attempts (UC-BET-05, thesis QS-SEC-01).
--
-- Only attempts that were NOT satisfied for the caller's own tenant land here.
-- Successful same-tenant traffic is deliberately not recorded: QS-SEC-01 counts
-- denied attempts, and writing a row per request would distort the response
-- times measured in QS-PER-03.
--
-- outcome tells apart the two enforcement styles the core actually uses:
--   DENIED          the application rejected the request outright (403).
--   FILTERED        the request named a foreign tenant, yet the application
--                   answered 2xx — it filtered the rows away instead of
--                   refusing. No data leaves, but the caller cannot tell the
--                   attempt was blocked, and neither could an operator without
--                   this row.
--   UNAUTHENTICATED no valid credentials at all (401).
-- The split between DENIED and FILTERED is the measurable part of QS-SEC-01.

CREATE TABLE access_audit (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    occurred_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Caller. subject is the JWT sub and is always known; user_id stays null
    -- when the subject has no provisioned platform user yet.
    subject          TEXT,
    user_id          UUID,

    -- Tenant the request named, null when the request named none.
    requested_tenant UUID,

    method           TEXT NOT NULL,
    path             TEXT NOT NULL,
    http_status      INT  NOT NULL,
    outcome          TEXT NOT NULL
                     CHECK (outcome IN ('DENIED', 'FILTERED', 'UNAUTHENTICATED'))
);

CREATE INDEX idx_access_audit_occurred ON access_audit (occurred_at DESC);
CREATE INDEX idx_access_audit_tenant   ON access_audit (requested_tenant, occurred_at DESC);
CREATE INDEX idx_access_audit_subject  ON access_audit (subject, occurred_at DESC);
