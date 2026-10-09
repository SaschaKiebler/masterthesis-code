#!/usr/bin/env python3
"""QS-SEC-01: systematic cross-tenant access attempts against core and analytics.

Response measure: "0 mandantenfremde Datensätze in den Antworten, je Versuch
genau 1 Audit-Eintrag" over "mindestens 100 Zugriffsversuche über alle
REST-Endpunkte hinweg".

The probe needs two tenants with data and one non-admin user in each. Two
seeded fleets with different prefixes give the tenants; the users are created
through the public invitation flow (invite as admin, accept with a password),
so no direct database writes are required.

Each attempt is classified into the vocabulary the AccessAuditFilter uses, which
is what makes the result a coverage map rather than a pass/fail bit:

  DENIED     401/403 — the endpoint refused. The only status that proves
             enforcement.
  NOT_FOUND  404 — says nothing about enforcement. An endpoint with no tenant
             check answers 404 for an id it cannot find, which looks like a
             refusal but is not one. Counting it as DENIED (as an earlier
             version of this script did) inflates the apparent enforcement.
  BAD_REQUEST 400/422 — the probe's own payload was wrong for that endpoint.
             A defect in this script, not a result; must be zero in a run that
             is reported.
  FILTERED   2xx, but no foreign identifier in the body: the endpoint narrowed
             its query instead of refusing. No data leaves, yet nothing signals
             the attempt either. This is the case the audit trail exists for.
  LEAK       2xx AND a foreign identifier in the body. A QS-SEC-01 failure.
  ERROR      transport failure, counted separately so it cannot hide a leak.

Leak detection is textual: the response body is searched for the other
tenant's identifiers (tenant id, project id, device ids, metric point ids,
object ids) harvested as admin during bootstrap. That over-approximates
rather than under-approximates — a false LEAK is investigated by hand, a
missed leak would be the dangerous direction.

Two families of attempts, because the core enforces them in two places:

  URL-carried ids   /projects/{B}, /objects/{B}/metrics, ?tenantId=B ...
                    resolved by the TenantScopeInterceptor.
  body-carried ids  {"siteId": B}, {"sourceId": A, "targetId": B},
                    {"bindings": [{"metricPointId": B}]}, ?metricPointIds=B ...
                    resolved by the TenantBodyGuard, which the review of
                    2026-09-02 added after twelve such fields were found
                    unchecked. These are WRITE attempts with an owned anchor
                    and a foreign id inside the payload. Under enforcement all
                    of them must be refused; if one is accepted the probe
                    reports it as LEAK regardless of the response body,
                    because a cross-tenant write that succeeded is the finding,
                    whether or not the foreign id is echoed back.
                    Skipped in --self-check (they would create real rows) and
                    with --no-writes.

Destructive endpoints (privacy erasure) are skipped unless
--include-destructive is passed: if isolation is broken there, the probe would
delete the other tenant's data instead of just reporting the hole.

Usage:
    # 1. seed two fleets (two tenants)
    mock-service seed --prefix tenanta --sites 1 --rooms 2 --persons 1
    mock-service seed --prefix tenantb --sites 1 --rooms 2 --persons 1
    # 2. run the probe
    python3 tenant_isolation_probe.py --csv ../results/qs-sec-01/qs-sec-01-attempts.csv

Audit verification is a separate step, because the databases are not exposed
outside the cluster. The script prints the exact SQL to run afterwards, e.g.
via `kubectl -n heating-platform exec deploy/stammdaten-db -- psql …`, or pass
--dsn for a local dev-stack run to have it checked automatically.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import uuid
from collections import Counter
from dataclasses import dataclass, field

import requests

UUID_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "heating-platform:mock-service")


@dataclass
class Attempt:
    actor: str           # which probe user made the call
    target_tenant: str   # whose data was aimed at
    service: str         # core | analytics
    method: str
    path: str
    status: int
    outcome: str         # DENIED | FILTERED | LEAK | ERROR
    leaked: list[str] = field(default_factory=list)


@dataclass
class TenantFixture:
    prefix: str
    tenant_id: str
    project_id: str | None
    site_id: str | None
    asset_id: str | None
    metric_point_ids: list[str]
    device_ids: list[str]
    object_ids: list[str]
    person_id: str | None
    email: str
    password: str
    token: str | None = None

    def identifiers(self) -> list[str]:
        """Everything whose presence in a response body proves a leak."""
        ids = [self.tenant_id, self.project_id, self.site_id, self.asset_id, self.person_id]
        ids += self.metric_point_ids + self.device_ids + self.object_ids
        return [i for i in ids if i]


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--core-host", default=os.environ.get("CORE_HOST", "http://localhost:8080"))
    p.add_argument("--analytics-host",
                   default=os.environ.get("ANALYTICS_HOST", "http://localhost:8100"))
    p.add_argument("--admin-email", default=os.environ.get("LOGIN_EMAIL", "admin@local"))
    p.add_argument("--admin-password", default=os.environ.get("LOGIN_PASSWORD", "admin"))
    p.add_argument("--prefix-a", default="tenanta")
    p.add_argument("--prefix-b", default="tenantb")
    p.add_argument("--probe-password", default="probe-pw-2026")
    p.add_argument("--no-writes", action="store_true",
                   help="skip the body-carried write attempts (POST/PATCH with a foreign id "
                        "inside the payload)")
    p.add_argument("--include-destructive", action="store_true",
                   help="also attempt privacy erasure across tenants (may DELETE on a leak)")
    p.add_argument("--setup-only", action="store_true",
                   help="only create the per-tenant probe users and exit. "
                        "QS-PER-03 needs a tenant-bound login, otherwise it "
                        "measures the bootstrap admin, who short-circuits the "
                        "tenant check and would report enforcement as free.")
    p.add_argument("--self-check", action="store_true",
                   help="run every request against the actor's OWN resources instead. "
                        "Expect 2xx everywhere and no audit rows: proves the enforcement "
                        "does not over-block, which a leak count alone cannot show")
    p.add_argument("--csv", help="write every attempt here")
    p.add_argument("--dsn", help="optional master-data DSN to verify audit entries locally")
    return p.parse_args()


# ── Bootstrap ────────────────────────────────────────────────────────────────

def login(core_host: str, email: str, password: str) -> str:
    resp = requests.post(f"{core_host}/api/v1/auth/login",
                         json={"email": email, "password": password}, timeout=10)
    if resp.status_code != 200:
        sys.exit(f"login as {email} failed: HTTP {resp.status_code} {resp.text[:200]}")
    return resp.json()["token"]


def tenant_id_for(prefix: str) -> str:
    """Same uuid5 recipe mock-service uses, so no lookup by name is needed."""
    return str(uuid.uuid5(UUID_NAMESPACE, f"{prefix}:tenant"))


def ensure_probe_user(core_host: str, admin_token: str, tenant_id: str,
                      email: str, password: str) -> None:
    """Invite (as admin) and accept (publicly) — creates a viewer in this tenant."""
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    # Already able to log in? Then the fixture exists from an earlier run.
    probe = requests.post(f"{core_host}/api/v1/auth/login",
                          json={"email": email, "password": password}, timeout=10)
    if probe.status_code == 200:
        return

    invite = requests.post(f"{core_host}/api/v1/invitations", headers=admin_headers,
                           json={"email": email, "tenantId": tenant_id,
                                 "tenantRole": "viewer", "globalRole": "viewer"},
                           timeout=10)
    if invite.status_code != 201:
        sys.exit(f"could not invite {email}: HTTP {invite.status_code} {invite.text[:200]}")
    token = invite.json()["invitation"]["token"]

    accept = requests.post(f"{core_host}/api/v1/invitations/by-token/{token}/accept",
                           json={"password": password, "displayName": f"Probe {email}"},
                           timeout=10)
    if accept.status_code not in (200, 201):
        sys.exit(f"could not accept invitation for {email}: "
                 f"HTTP {accept.status_code} {accept.text[:200]}")


def harvest(core_host: str, admin_token: str, prefix: str,
            email: str, password: str) -> TenantFixture:
    """Collect the identifiers of one seeded fleet, as admin."""
    headers = {"Authorization": f"Bearer {admin_token}"}
    tenant_id = tenant_id_for(prefix)

    projects = requests.get(f"{core_host}/api/v1/projects",
                            headers=headers, timeout=10).json()["projects"]
    project = next((p for p in projects if p.get("tenantId") == tenant_id), None)
    if project is None:
        sys.exit(f"no project for tenant of prefix '{prefix}' — seed it first "
                 f"(mock-service seed --prefix {prefix} …)")
    project_id = project["id"]

    points = requests.get(f"{core_host}/api/v1/projects/{project_id}/metric-points",
                          headers=headers, timeout=30).json()["metricPoints"]
    metric_point_ids = [p["id"] for p in points][:10]
    device_ids = sorted({p["deviceId"] for p in points})[:5]
    asset_id = next((p.get("assetId") for p in points if p.get("assetId")), None)

    graph = requests.get(f"{core_host}/api/v1/projects/{project_id}/graph",
                         headers=headers, timeout=30)
    site_id = None
    person_id = None
    object_ids: list[str] = []
    if graph.status_code == 200:
        for obj in graph.json().get("objects", []):
            type_name = (obj.get("objectTypeName") or obj.get("typeName") or "")
            obj_id = obj.get("id")
            if type_name == "BUILDING" and site_id is None:
                site_id = obj_id
            if type_name == "PERSON" and person_id is None:
                person_id = obj_id
            if obj_id:
                object_ids.append(obj_id)

    return TenantFixture(prefix=prefix, tenant_id=tenant_id, project_id=project_id,
                         site_id=site_id, asset_id=asset_id,
                         metric_point_ids=metric_point_ids, device_ids=device_ids,
                         object_ids=object_ids[:10],
                         person_id=person_id, email=email, password=password)


# ── Attempts ─────────────────────────────────────────────────────────────────

def classify(resp: requests.Response, foreign_ids: list[str],
             write: bool = False) -> tuple[str, list[str]]:
    """Only 401/403 proves enforcement — see the module docstring."""
    if resp.status_code in (401, 403):
        return "DENIED", []
    if resp.status_code == 404:
        return "NOT_FOUND", []
    if resp.status_code in (400, 422):
        return "BAD_REQUEST", []
    if resp.status_code >= 400:
        return "ERROR", [f"unexpected HTTP {resp.status_code}"]
    body = resp.text
    hits = [i for i in foreign_ids if i and i in body]
    if write:
        # An accepted cross-tenant write is the finding itself; the body of a
        # 201 rarely echoes the foreign id ("Site added to project").
        return "LEAK", hits or ["write accepted"]
    return ("LEAK", hits) if hits else ("FILTERED", [])


def attempt(session: requests.Session, actor: TenantFixture, target: TenantFixture,
            service: str, host: str, method: str, path: str,
            payload: dict | None = None, write: bool = False) -> Attempt:
    url = f"{host}{path}"
    try:
        if method == "GET":
            resp = session.get(url, timeout=15)
        elif method == "POST":
            resp = session.post(url, json=payload, timeout=15)
        elif method == "PATCH":
            resp = session.patch(url, json=payload, timeout=15)
        elif method == "DELETE":
            resp = session.delete(url, timeout=15)
        else:
            raise ValueError(method)
    except requests.RequestException as e:
        return Attempt(actor.prefix, target.prefix, service, method, path, 0, "ERROR",
                       [str(e)[:80]])

    outcome, hits = classify(resp, target.identifiers(), write)
    return Attempt(actor.prefix, target.prefix, service, method, path,
                   resp.status_code, outcome, hits)


def core_paths(target: TenantFixture) -> list[tuple[str, str, dict | None]]:
    """Core endpoints addressed with the OTHER tenant's identifiers.

    Breadth matters more than depth here: QS-SEC-01 asks for at least 100
    attempts "über alle REST-Endpunkte hinweg", and the result is only a
    coverage map if every read surface a dashboard uses is represented.
    """
    paths: list[tuple[str, str, dict | None]] = []
    p, s, a = target.project_id, target.site_id, target.asset_id

    if p:
        for sub in ("", "/metric-points", "/latest-values", "/health", "/graph",
                    "/channels", "/dashboards", "/settings", "/derived-properties",
                    "/events?limit=50",
                    # These two declare required query parameters; without them
                    # Spring rejects the request before the handler runs and the
                    # probe would measure its own malformed call.
                    "/metric-pairs?quantity1=Flow%20Temperature"
                    "&quantity2=Return%20Temperature",
                    "/quantity-channels?quantityName=Flow%20Temperature"):
            paths.append(("GET", f"/api/v1/projects/{p}{sub}", None))
    if s:
        for sub in ("/objects", "/graph", "/spaces"):
            paths.append(("GET", f"/api/v1/sites/{s}{sub}", None))
    if a:
        for sub in ("/metrics", "/events"):
            paths.append(("GET", f"/api/v1/objects/{a}{sub}", None))

    for mp in target.metric_point_ids:
        paths.append(("GET", f"/api/v1/metric-points/{mp}", None))
    for obj in target.object_ids:
        paths.append(("GET", f"/api/v1/objects/{obj}/metrics", None))

    paths += [("GET", f"/api/v1/tenants/{target.tenant_id}", None),
              ("GET", f"/api/v1/tenants/{target.tenant_id}/members", None),
              ("GET", f"/api/v1/sites?page=1&pageSize=100&tenantId={target.tenant_id}", None)]

    if target.person_id:
        paths.append(("GET", f"/api/v1/privacy/persons/{target.person_id}/export", None))

    # List endpoints that must filter rather than refuse — a leak here means
    # the caller sees the other tenant inside a collection response.
    paths += [("GET", "/api/v1/projects", None),
              ("GET", "/api/v1/tenants", None),
              ("GET", "/api/v1/events?limit=50", None),
              ("GET", "/api/v1/fleet/status", None),
              ("GET", "/api/v1/discovered-devices", None)]
    return paths


def core_write_paths(actor: TenantFixture,
                     target: TenantFixture) -> list[tuple[str, str, dict | None]]:
    """Writes anchored on the ACTOR's own resources that smuggle one of the
    TARGET's ids in the body or in a query parameter the interceptor does not
    parse. Every entry corresponds to a gap the review of 2026-09-02 closed.

    Payloads are shaped so that the tenant guard is the FIRST thing that can
    refuse them: valid types, valid detector key, existing anchors. A 400 here
    would mean the probe measured its own malformed call.
    """
    paths: list[tuple[str, str, dict | None]] = []
    t = target
    foreign_obj = t.object_ids[0] if t.object_ids else None
    foreign_mp = t.metric_point_ids[0] if t.metric_point_ids else None
    foreign_dev = t.device_ids[0] if t.device_ids else None

    # G1  project inside the other tenant
    paths.append(("POST", "/api/v1/projects",
                  {"name": "probe", "tenantId": t.tenant_id}))
    # G2  foreign site pulled into an owned project (bulk read afterwards)
    if actor.project_id and t.site_id:
        paths.append(("POST", f"/api/v1/projects/{actor.project_id}/sites",
                      {"siteId": t.site_id}))
    # G3  link from an owned object to a foreign one
    if actor.site_id and foreign_obj:
        paths.append(("POST", "/api/v1/links",
                      {"sourceId": actor.site_id, "targetId": foreign_obj,
                       "linkTypeName": "CONTAINS"}))
    # G4  object created in the other tenant / registered in its project
    paths.append(("POST", "/api/v1/objects",
                  {"objectTypeName": "ROOM", "displayName": "probe", "tenantId": t.tenant_id}))
    if t.project_id:
        paths.append(("POST", "/api/v1/objects",
                      {"objectTypeName": "ROOM", "displayName": "probe",
                       "tenantId": actor.tenant_id, "projectId": t.project_id}))
    # G5  KPI formula bound to a foreign metric point
    if actor.asset_id and foreign_mp:
        paths.append(("POST", f"/api/v1/objects/{actor.asset_id}/kpi-formulas",
                      {"name": "probe_kpi", "formula": "x",
                       "variables": {"x": {"source": "DIRECT", "metricPointId": foreign_mp}}}))
    # G6  anomaly rule bound to a foreign metric point
    if foreign_mp:
        paths.append(("POST", "/api/v1/anomaly-rules",
                      {"name": "probe_rule", "detector": "short_cycle",
                       "bindings": [{"role": "switch", "metricPointId": foreign_mp}]}))
    # G7  foreign metric points named in the query string of an owned project
    if actor.project_id and foreign_mp:
        paths.append(("GET", f"/api/v1/projects/{actor.project_id}/channels"
                             f"?metricPointIds={foreign_mp}", None))
    # G8  derived property written onto a foreign object
    if foreign_obj:
        paths.append(("POST", "/api/v1/derived-properties",
                      {"objectId": foreign_obj, "propertyName": "probe", "valueText": "x"}))
    # G9  owned asset relocated into a foreign site
    if actor.asset_id and t.site_id:
        paths.append(("POST", f"/api/v1/assets/{actor.asset_id}/relocate",
                      {"targetSiteId": t.site_id}))
    # G10 analysis template inside the other tenant
    paths.append(("POST", "/api/v1/analysis-templates",
                  {"name": "probe", "definition": {}, "tenantId": t.tenant_id}))
    # G11 KPI generation with the other tenant's project as context
    if actor.asset_id and t.project_id:
        paths.append(("POST", f"/api/v1/objects/{actor.asset_id}/kpi-formulas/generate",
                      {"prompt": "probe", "projectId": t.project_id}))
    # G12 metric point on the other tenant's device id / under its tenant
    if actor.asset_id and foreign_dev:
        paths.append(("POST", f"/api/v1/objects/{actor.asset_id}/metrics",
                      {"deviceId": foreign_dev, "metricId": 99, "unit": "x"}))
    if actor.asset_id:
        paths.append(("POST", f"/api/v1/objects/{actor.asset_id}/metrics",
                      {"deviceId": "probe-device", "metricId": 99, "unit": "x",
                       "tenantId": t.tenant_id}))
    return paths


def analytics_unscoped_paths() -> list[tuple[str, str, dict | None]]:
    """Requests that name NO id and therefore addressed, before the fix of
    2026-09-02, the whole measurement store. Must be refused for a tenant user."""
    return [("POST", "/stats/ingest-rate", {"window_minutes": 60}),
            ("POST", "/stats/ingest-rate", {"metric_point_ids": [], "window_minutes": 60})]


def analytics_paths(target: TenantFixture) -> list[tuple[str, str, dict | None]]:
    """Analytics is queried with the OTHER tenant's metric point ids."""
    if not target.metric_point_ids:
        return []
    ids = target.metric_point_ids
    window = {"start": 0, "end": 4102444800}  # wide window, any stored data qualifies
    channels = [{"device_id": d, "metric_id": 1, "ref": d} for d in target.device_ids]

    paths: list[tuple[str, str, dict | None]] = [
        ("POST", "/stats/latest", {"metric_point_ids": ids}),
        ("POST", "/stats/timeseries", {"metric_point_ids": ids[:5],
                                       "time_range": window, "resample": "1h"}),
        ("POST", "/stats/descriptive", {"metric_point_ids": ids[:5], "time_range": window}),
        ("POST", "/stats/histogram", {"metric_point_ids": ids[:2], "time_range": window}),
        ("POST", "/stats/boxplot", {"metric_point_ids": ids[:2], "time_range": window}),
        # heatmap is the only endpoint taking a SINGULAR metric_point_id.
        ("POST", "/stats/heatmap", {"metric_point_id": ids[0], "time_range": window}),
        ("POST", "/stats/ingest-rate", {"metric_point_ids": ids, "window_minutes": 60}),
    ]
    if len(ids) >= 2:
        paths.append(("POST", "/stats/difference",
                      {"metric_point_id_a": ids[0], "metric_point_id_b": ids[1],
                       "time_range": window, "resample": "1h"}))
    if channels:
        # Bypasses the registry lookup entirely — worth probing separately,
        # because it addresses the measurement store by raw device id.
        paths.append(("POST", "/stats/series",
                      {"channels": channels[:3], "start": window["start"],
                       "end": window["end"], "resample": "1h", "aggregation": "mean"}))
        paths.append(("POST", "/stats/latest-by-channel", {"channels": channels[:3]}))
    return paths


def run_direction(args, actor: TenantFixture, target: TenantFixture) -> list[Attempt]:
    core = requests.Session()
    core.headers["Authorization"] = f"Bearer {actor.token}"
    analytics = requests.Session()
    analytics.headers["Authorization"] = f"Bearer {actor.token}"

    attempts = [attempt(core, actor, target, "core", args.core_host, m, p, b)
                for m, p, b in core_paths(target)]
    attempts += [attempt(analytics, actor, target, "analytics", args.analytics_host, m, p, b)
                 for m, p, b in analytics_paths(target)]

    # Body-carried ids. Only meaningful against the OTHER tenant: against the
    # actor's own resources these would create real rows.
    if not args.no_writes and actor is not target:
        attempts += [attempt(core, actor, target, "core", args.core_host, m, p, b,
                             write=(m != "GET"))
                     for m, p, b in core_write_paths(actor, target)]
        attempts += [attempt(analytics, actor, target, "analytics", args.analytics_host,
                             m, p, b, write=True)
                     for m, p, b in analytics_unscoped_paths()]

    if args.include_destructive and target.person_id:
        attempts.append(attempt(core, actor, target, "core", args.core_host,
                                "DELETE", f"/api/v1/privacy/persons/{target.person_id}"))
    return attempts


# ── Reporting ────────────────────────────────────────────────────────────────

def audit_sql(attempts: list[Attempt]) -> str:
    return (
        "SELECT outcome, count(*) FROM access_audit "
        f"WHERE path LIKE '/api/v1/%' AND occurred_at > now() - interval '1 hour' "
        "GROUP BY outcome ORDER BY 2 DESC;"
    )


def verify_audit(dsn: str, expected: int) -> None:
    try:
        import psycopg
    except ImportError:
        print("  (psycopg not installed — skipping automatic audit verification)")
        return
    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute("SELECT outcome, count(*) FROM access_audit "
                    "WHERE occurred_at > now() - interval '1 hour' GROUP BY outcome")
        rows = cur.fetchall()
    total = sum(c for _, c in rows)
    print(f"  audit entries in the last hour: {total} "
          f"({', '.join(f'{o}={c}' for o, c in rows) or 'none'})")
    print(f"  attempts made: {expected}  →  "
          f"{'matches' if total >= expected else 'FEWER THAN ATTEMPTS — finding for 6.3.1'}")


def self_check(args, fixtures: list[TenantFixture]) -> int:
    """Every request against the actor's OWN resources must still succeed.

    The counterpart to the cross-tenant run. Without it "0 leaks" is also what
    a mechanism that refuses everything would report; together the two runs
    show the enforcement is placed correctly rather than merely tight.
    """
    attempts: list[Attempt] = []
    for fixture in fixtures:
        attempts += run_direction(args, fixture, fixture)

    counts = Counter(x.outcome for x in attempts)
    over_blocked = [x for x in attempts if x.outcome in ("DENIED", "ERROR")]

    print(f"\nSELF-CHECK: {len(attempts)} requests against the caller's own resources "
          f"(body-carried write attempts are not repeated here, they would create rows)")
    for outcome in ("FILTERED", "LEAK", "DENIED", "NOT_FOUND", "BAD_REQUEST", "ERROR"):
        print(f"  {outcome:<12} {counts.get(outcome, 0)}")
    print("  (LEAK here means 'own data returned', which is the expected outcome)")

    if over_blocked:
        print(f"\n{len(over_blocked)} OVER-BLOCKED — own resources were refused:")
        for x in over_blocked:
            print(f"  {x.service:<9} {x.method:<6} {x.path}  HTTP {x.status}")
    else:
        print("\nno own resource was refused")

    if args.csv:
        with open(args.csv, "w", newline="") as fh:
            writer = csv.writer(fh)
            writer.writerow(["actor", "target_tenant", "service", "method", "path",
                             "status", "outcome", "leaked_identifiers"])
            for x in attempts:
                writer.writerow([x.actor, x.target_tenant, x.service, x.method, x.path,
                                 x.status, x.outcome, json.dumps(x.leaked)])
        print(f"\nall attempts written to {args.csv}")

    return 1 if over_blocked else 0


def main() -> int:
    args = parse_args()

    admin_token = login(args.core_host, args.admin_email, args.admin_password)

    fixtures = []
    for prefix in (args.prefix_a, args.prefix_b):
        email = f"probe-{prefix}@example.org"
        fixture = harvest(args.core_host, admin_token, prefix, email, args.probe_password)
        ensure_probe_user(args.core_host, admin_token, fixture.tenant_id,
                          email, args.probe_password)
        fixture.token = login(args.core_host, email, args.probe_password)
        fixtures.append(fixture)
    a, b = fixtures

    for f in (a, b):
        print(f"tenant '{f.prefix}': project={f.project_id} "
              f"metric_points={len(f.metric_point_ids)} devices={len(f.device_ids)} "
              f"person={'yes' if f.person_id else 'no'} user={f.email}")

    if args.setup_only:
        print(f"\nsetup only: probe users exist and can log in. "
              f"Use LOGIN_EMAIL={a.email} LOGIN_PASSWORD={args.probe_password} "
              f"for the query-API load (QS-PER-03).")
        return 0

    if args.self_check:
        return self_check(args, [a, b])

    attempts = run_direction(args, a, b) + run_direction(args, b, a)

    counts = Counter(x.outcome for x in attempts)
    leaks = [x for x in attempts if x.outcome == "LEAK"]

    print(f"\n{len(attempts)} cross-tenant attempts "
          f"({'meets' if len(attempts) >= 100 else 'BELOW'} the 100 required by QS-SEC-01)")
    for outcome in ("DENIED", "FILTERED", "LEAK", "NOT_FOUND", "BAD_REQUEST", "ERROR"):
        print(f"  {outcome:<12} {counts.get(outcome, 0)}")
    if counts.get("BAD_REQUEST"):
        print("  !! BAD_REQUEST means this script sent a malformed payload — fix "
              "before reporting the run")

    if leaks:
        print(f"\n{len(leaks)} LEAKS — foreign data in the response body:")
        for x in leaks:
            print(f"  {x.service:<9} {x.method:<6} {x.path}  "
                  f"HTTP {x.status}  leaked {len(x.leaked)} identifier(s)")
    else:
        print("\nno foreign records in any response body")

    print("\nAudit verification (run against the master-data DB):")
    print(f"  {audit_sql(attempts)}")
    if args.dsn:
        verify_audit(args.dsn, len(attempts))

    if args.csv:
        with open(args.csv, "w", newline="") as fh:
            writer = csv.writer(fh)
            writer.writerow(["actor", "target_tenant", "service", "method", "path",
                             "status", "outcome", "leaked_identifiers"])
            for x in attempts:
                writer.writerow([x.actor, x.target_tenant, x.service, x.method, x.path,
                                 x.status, x.outcome, json.dumps(x.leaked)])
        print(f"\nall attempts written to {args.csv}")

    return 1 if leaks else 0


if __name__ == "__main__":
    sys.exit(main())
