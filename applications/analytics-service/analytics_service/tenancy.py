"""Tenant authorisation for the /stats API.

Until this module existed, analytics validated the JWT signature and nothing
else: any valid token could read any tenant's measurements. A probe of 106
cross-tenant attempts found 20 hitting analytics, 11 of which returned foreign
data.

The check runs as a router-level dependency, so no endpoint signature changes.
That works because Starlette caches the request body on first read, letting
this dependency inspect the JSON while FastAPI's own model binding still gets
the same bytes afterwards.

Two endpoint classes need different resolutions:

  A. registry-resolvable — the body carries metric point ids, which resolve to
     a tenant through `metric_points JOIN objects`. Two of the service's three
     existing registry queries already perform that join, so this is not a new
     query shape.

  B. raw channels (routers/series.py) — the body carries {device_id, metric_id}
     pairs and bypasses the registry entirely. These resolve backwards through
     the UNIQUE (device_id, metric_id) constraint. Note that the `ref` field in
     a channel is caller-supplied and echoed unchanged; it must never be the
     authorisation key.

Membership is duplicated here rather than asked of core on every request: a
synchronous hop to core would put analytics' availability at the mercy of
another service on the hot path. The duplication is deliberate and stated.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request

from .auth import require_token
from .config import settings
from .db.pool import get_registry_pool

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Membership:
    """Which tenants a subject may see. `unlimited` is a system admin."""

    user_id: str | None
    tenants: frozenset[str]
    unlimited: bool

    def covers(self, tenant_id: str | None) -> bool:
        return self.unlimited or (tenant_id is not None and tenant_id in self.tenants)


# subject -> (expires_at_monotonic, Membership); TTL pattern as in detection/weather.py
_membership_cache: dict[str, tuple[float, Membership]] = {}
# (kind, key) -> (expires_at_monotonic, tenant_id or None)
_scope_cache: dict[tuple[str, str], tuple[float, str | None]] = {}

# Body fields carrying registry-resolvable ids, per endpoint shape.
_ID_LIST_FIELDS = ("metric_point_ids",)
_ID_SINGLE_FIELDS = (
    "metric_point_id",       # heatmap — the only singular one
    "metric_point_id_a",     # difference
    "metric_point_id_b",
    "x_metric_point_id",     # regression
    "y_metric_point_id",
)


async def _membership(subject: str) -> Membership:
    now = time.monotonic()
    cached = _membership_cache.get(subject)
    if cached and cached[0] > now:
        return cached[1]

    pool = await get_registry_pool()
    row = await pool.fetchrow(
        """
        SELECT u.id::text AS user_id,
               u.global_role,
               coalesce(array_agg(r.tenant_id::text)
                        FILTER (WHERE r.tenant_id IS NOT NULL), '{}') AS tenants
        FROM users u
        LEFT JOIN user_tenant_roles r ON r.user_id = u.id
        WHERE u.subject = $1
        GROUP BY u.id, u.global_role
        """,
        subject,
    )

    if row is None:
        # A subject without a platform user belongs nowhere. It must map to
        # "sees nothing", never to "unrestricted".
        membership = Membership(None, frozenset(), False)
    else:
        membership = Membership(
            user_id=row["user_id"],
            tenants=frozenset(row["tenants"]),
            unlimited=row["global_role"] == "system_admin",
        )

    _membership_cache[subject] = (now + settings.tenant_membership_ttl_seconds, membership)
    return membership


async def _tenants_of_metric_points(ids: list[str]) -> dict[str, str | None]:
    """metric point id -> owning tenant (None for a global object)."""
    resolved: dict[str, str | None] = {}
    missing: list[str] = []
    now = time.monotonic()

    for mp_id in ids:
        cached = _scope_cache.get(("mp", mp_id))
        if cached and cached[0] > now:
            resolved[mp_id] = cached[1]
        else:
            missing.append(mp_id)

    if missing:
        pool = await get_registry_pool()
        rows = await pool.fetch(
            """
            SELECT mp.id::text AS id, o.tenant_id::text AS tenant_id
            FROM metric_points mp
            JOIN objects o ON o.id = mp.id
            WHERE mp.id = ANY($1::uuid[])
            """,
            missing,
        )
        found = {r["id"]: r["tenant_id"] for r in rows}
        for mp_id in missing:
            tenant = found.get(mp_id)
            resolved[mp_id] = tenant
            if mp_id in found:
                _scope_cache[("mp", mp_id)] = (
                    now + settings.tenant_scope_cache_ttl_seconds, tenant)
    return resolved


async def _tenants_of_channels(channels: list[dict]) -> dict[str, str | None]:
    """(device_id, metric_id) -> owning tenant, resolved backwards.

    The reverse direction is what makes the channel endpoints safe: the caller
    addresses measurement rows by their natural key, so the authorisation must
    use that same key rather than the caller's own `ref` label.
    """
    pairs = [(str(c.get("device_id")), int(c.get("metric_id"))) for c in channels
             if c.get("device_id") is not None and c.get("metric_id") is not None]
    if not pairs:
        return {}

    pool = await get_registry_pool()
    rows = await pool.fetch(
        """
        SELECT mp.device_id, mp.metric_id, o.tenant_id::text AS tenant_id
        FROM metric_points mp
        JOIN objects o ON o.id = mp.id
        WHERE (mp.device_id, mp.metric_id)
              IN (SELECT * FROM unnest($1::text[], $2::int[]))
        """,
        [p[0] for p in pairs],
        [p[1] for p in pairs],
    )
    found = {f"{r['device_id']}:{r['metric_id']}": r["tenant_id"] for r in rows}
    return {f"{d}:{m}": found.get(f"{d}:{m}") for d, m in pairs}


def _collect_ids(body: dict) -> tuple[list[str], list[dict], bool]:
    """Pull the addressed ids out of any of the 13 request shapes.

    Returns (metric point ids, channels, whether the body asked for an
    unscoped aggregate over the whole store).
    """
    metric_point_ids: list[str] = []
    channels: list[dict] = []
    unscoped_aggregate = False

    for field in _ID_LIST_FIELDS:
        if field in body:
            value = body.get(field)
            if value is None:
                # ingest-rate accepts null to mean "the entire store".
                unscoped_aggregate = True
            elif isinstance(value, list):
                metric_point_ids.extend(str(v) for v in value)

    for field in _ID_SINGLE_FIELDS:
        value = body.get(field)
        if isinstance(value, str):
            metric_point_ids.append(value)

    # compute: {"sources": [{"metric_point_id": ...}, ...]}
    for source in body.get("sources") or []:
        if isinstance(source, dict) and isinstance(source.get("metric_point_id"), str):
            metric_point_ids.append(source["metric_point_id"])

    for channel in body.get("channels") or []:
        if isinstance(channel, dict):
            channels.append(channel)

    return metric_point_ids, channels, unscoped_aggregate


async def require_tenant_scope(request: Request, _: None = Depends(require_token)) -> None:
    """Refuse any /stats request addressing another tenant's data.

    Declares require_token as its own dependency so the subject is always
    resolved first, whatever order the router lists them in.
    """
    if settings.tenant_enforcement == "off":
        return

    subject = getattr(request.state, "subject", None)
    if subject is None:
        # Auth disabled or no principal: nothing to authorise against. The
        # token check is require_token's job, not this dependency's.
        return

    try:
        body = await request.json()
    except Exception:
        # No body or unparsable: the endpoint's own validation will answer.
        return
    if not isinstance(body, dict):
        return

    metric_point_ids, channels, unscoped_aggregate = _collect_ids(body)
    membership = await _membership(subject)

    if unscoped_aggregate and not membership.unlimited:
        return await _refuse(request, subject, membership,
                             "aggregate over the whole measurement store requires metric_point_ids")

    foreign: list[str] = []
    if metric_point_ids:
        for mp_id, tenant in (await _tenants_of_metric_points(metric_point_ids)).items():
            if not membership.covers(tenant):
                foreign.append(mp_id)
    if channels:
        for key, tenant in (await _tenants_of_channels(channels)).items():
            if not membership.covers(tenant):
                foreign.append(key)

    if foreign:
        return await _refuse(request, subject, membership,
                             f"{len(foreign)} of the addressed channels belong to another tenant")


async def _refuse(request: Request, subject: str, membership: Membership, detail: str) -> None:
    """Deny, or in observe mode only log — mirrors the core's OFF/OBSERVE/ENFORCE."""
    observing = settings.tenant_enforcement == "observe"
    log.info("%sDenied cross-tenant access: %s %s for subject %s (%s)",
             "OBSERVE: would have " if observing else "",
             request.method, request.url.path, subject, detail)

    await _write_audit(request, subject, membership,
                       status=200 if observing else 403,
                       outcome="FILTERED" if observing else "DENIED")

    if not observing:
        raise HTTPException(status_code=403, detail="Access denied to another tenant's data")


async def _write_audit(request: Request, subject: str, membership: Membership,
                       status: int, outcome: str) -> None:
    """Record the attempt in the platform's access_audit table.

    QS-SEC-01 asks for one audit entry per attempt, and roughly a fifth of the
    attempts reach analytics. Writing here closes that gap with a single INSERT
    into an append-only table in a database this service already reads.

    It does make analytics a writer to the master-data store, which the
    architecture otherwise reserves for core — a deliberate deepening of the
    documented shared-database deviation, limited to this one audit table and
    switchable off. Failures are swallowed: an audit trail must never break the
    request it observes.
    """
    if not settings.analytics_audit_enabled:
        return
    try:
        pool = await get_registry_pool()
        await pool.execute(
            """
            INSERT INTO access_audit
                (subject, user_id, requested_tenant, method, path, http_status, outcome)
            VALUES ($1, $2::uuid, NULL, $3, $4, $5, $6)
            """,
            subject, membership.user_id, request.method, request.url.path, status, outcome,
        )
    except Exception as e:  # noqa: BLE001 — auditing must not fail the request
        log.warning("Could not write access audit entry for %s %s: %s",
                    request.method, request.url.path, e)
