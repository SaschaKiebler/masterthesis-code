#!/usr/bin/env python3
"""QS-SEC-01: systematic cross-tenant access attempts against core and analytics.

Response measure: "0 mandantenfremde Datensätze in den Antworten, je Versuch
genau 1 Audit-Eintrag" over "mindestens 100 Zugriffsversuche über alle
REST-Endpunkte hinweg".

The probe needs two tenants with data and one non-admin user in each. Two
seeded fleets with different prefixes give the tenants; the users are created
through the public invitation flow (invite as admin, accept with a password),
so no direct database writes are required.

Each attempt is classified into the same vocabulary the AccessAuditFilter uses,
which is what makes the result a coverage map rather than a pass/fail bit:

  DENIED    4xx — the endpoint refused outright.
  FILTERED  2xx, but no foreign identifier in the body: the endpoint narrowed
            its query instead of refusing. No data leaves, yet nothing signals
            the attempt either. This is the case the audit trail exists for.
  LEAK      2xx AND a foreign identifier in the body. A QS-SEC-01 failure.
  ERROR     transport failure, counted separately so it cannot hide a leak.

Leak detection is textual: the response body is searched for the other
tenant's identifiers (tenant id, project id, device ids, metric point ids,
object ids) harvested as admin during bootstrap. That over-approximates
rather than under-approximates — a false LEAK is investigated by hand, a
missed leak would be the dangerous direction.

Destructive endpoints (privacy erasure) are skipped unless
--include-destructive is passed: if isolation is broken there, the probe would
delete the other tenant's data instead of just reporting the hole.

Usage:
    # 1. seed two fleets (two tenants)
    mock-service seed --prefix tenanta --sites 1 --rooms 2 --persons 1
    mock-service seed --prefix tenantb --sites 1 --rooms 2 --persons 1
    # 2. run the probe
    python3 tenant_isolation_probe.py --csv ../results/qs-sec-01-attempts.csv

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

UUID_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "digitaldemon:mock-service")


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
    p.add_argument("--include-destructive", action="store_true",
                   help="also attempt privacy erasure across tenants (may DELETE on a leak)")
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

def classify(resp: requests.Response, foreign_ids: list[str]) -> tuple[str, list[str]]:
    if resp.status_code >= 400:
        return "DENIED", []
    body = resp.text
    hits = [i for i in foreign_ids if i and i in body]
    return ("LEAK", hits) if hits else ("FILTERED", [])


def attempt(session: requests.Session, actor: TenantFixture, target: TenantFixture,
            service: str, host: str, method: str, path: str,
            payload: dict | None = None) -> Attempt:
    url = f"{host}{path}"
    try:
        if method == "GET":
            resp = session.get(url, timeout=15)
        elif method == "POST":
            resp = session.post(url, json=payload, timeout=15)
        elif method == "DELETE":
            resp = session.delete(url, timeout=15)
        else:
            raise ValueError(method)
    except requests.RequestException as e:
        return Attempt(actor.prefix, target.prefix, service, method, path, 0, "ERROR",
                       [str(e)[:80]])

    outcome, hits = classify(resp, target.identifiers())
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
                    "/metric-pairs", "/quantity-channels", "/events?limit=50"):
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
              ("GET", "/api/v1/devices/discovered", None)]
    return paths


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
        ("POST", "/stats/heatmap", {"metric_point_ids": ids[:1], "time_range": window}),
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

    attempts = run_direction(args, a, b) + run_direction(args, b, a)

    counts = Counter(x.outcome for x in attempts)
    leaks = [x for x in attempts if x.outcome == "LEAK"]

    print(f"\n{len(attempts)} cross-tenant attempts "
          f"({'meets' if len(attempts) >= 100 else 'BELOW'} the 100 required by QS-SEC-01)")
    for outcome in ("DENIED", "FILTERED", "LEAK", "ERROR"):
        print(f"  {outcome:<9} {counts.get(outcome, 0)}")

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
