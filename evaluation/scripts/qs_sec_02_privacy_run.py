#!/usr/bin/env python3
"""QS-SEC-02: GDPR subject access and erasure, measured on the local dev stack.

Response measure (thesis ch. 3): "Export deckt 100 % des Referenzinventars ab,
nach dem Löschlauf 0 Treffer bei Nachabfrage, Laufzeit unter 15 min."

What one run does, in order, and what each step is evidence for:

  1. inventory   Reads what the master-data store holds about the subject
                 (person row, residences, links, derived properties, the
                 devices reachable through the graph) and how many measurement
                 rows the measurement store holds per device. This is the
                 reference inventory, taken from the DATA, not from the export.
  2. export      GET /api/v1/privacy/persons/{id}/export, saved verbatim as
                 the Art. 15(3) copy. Compared item by item against step 1.
                 -> coverage, must be 100 %.
  3. erase       DELETE /api/v1/privacy/persons/{id}, timed. The erasure
                 report lists what the measurement store retains.
  4. residual    evaluation/sql/privacy-residual-check.sql against the
                 master-data store, the canonical six checks. Any row outside
                 the documented exceptions is a finding.
                 -> residual hits, must be 0.
  5. re-query    The privacy endpoint and the object endpoint must not know
                 the subject any more (404). The measurement rows must be
                 UNCHANGED, because the deviation from the ch. 4 design is
                 exactly that the series is severed, not deleted
                 (Art. 17(3)(b), QA-INT). That number goes into the thesis as
                 the QA-SEC vs QA-INT trade-off, so it is measured, not assumed.

Preconditions (the script checks them and tells you what is missing):
  - scripts/dev.sh up                       the full local stack
  - a fleet seeded WITH persons, e.g.
      mock-service seed --prefix gdpr --sites 1 --rooms 2 --persons 2
  - some telemetry for that fleet, e.g. two minutes of
      mock-service run  --prefix gdpr --sites 1 --rooms 2 --interval 2 --duration 120
    and the generator FINISHED, otherwise the row counts drift between
    inventory and export and the comparison reports a spurious mismatch.

Subject selection: by default person 1 of site 1 of the given prefix, whose
id is deterministic (same uuid5 recipe as mock-service). Pass --subject-id to
measure any other PERSON object.

The erasure is destructive for that one synthetic person. Re-seeding recreates
it, so a run can be repeated. --skip-erase stops after the export comparison.

Usage:
    .venv/bin/python qs_sec_02_privacy_run.py --prefix gdpr
    .venv/bin/python qs_sec_02_privacy_run.py --prefix gdpr --skip-erase
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import psycopg
import requests

REPO_ROOT = Path(__file__).resolve().parents[2]
COMPOSE_FILE = "docker/docker-compose-kafka.yaml"
RESIDUAL_SQL = REPO_ROOT / "evaluation" / "sql" / "privacy-residual-check.sql"

# Same namespace as mock-service, so the subject id needs no lookup.
UUID_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "digitaldemon:mock-service")

# The sections of privacy-residual-check.sql whose hits are findings, and the
# one whose hits are expected (audit trail, retained by design).
RESIDUAL_FINDING_SECTIONS = ("1", "2", "3", "4", "5", "6")
RESIDUAL_EXPECTED_SECTIONS = ("E1",)

# The graph walk of evaluation/sql/privacy-inventory.sql, section 4, with a
# parameter placeholder instead of the psql variable. Kept identical on purpose.
DEVICES_SQL = """
WITH RECURSIVE
lt AS (
    SELECT name, id FROM link_types
    WHERE name IN ('RESIDES_IN', 'CONTAINS', 'INSTALLED_IN', 'REALIZED_BY', 'HAS_METRIC')
),
spaces AS (
    SELECT l.target_object_id AS id, 0 AS depth
    FROM links l JOIN lt ON lt.id = l.link_type_id AND lt.name = 'RESIDES_IN'
    WHERE l.source_object_id = %s
    UNION
    SELECT l.target_object_id, s.depth + 1
    FROM spaces s
    JOIN links l ON l.source_object_id = s.id
    JOIN lt ON lt.id = l.link_type_id AND lt.name = 'CONTAINS'
    WHERE s.depth < 5
),
assets AS (
    SELECT DISTINCT l.source_object_id AS id
    FROM links l JOIN lt ON lt.id = l.link_type_id AND lt.name = 'INSTALLED_IN'
    WHERE l.target_object_id IN (SELECT id FROM spaces)
),
devices AS (
    SELECT pd.device_id
    FROM links l
    JOIN lt ON lt.id = l.link_type_id AND lt.name = 'REALIZED_BY'
    JOIN physical_devices pd ON pd.id = l.target_object_id
    WHERE l.source_object_id IN (SELECT id FROM assets)
    UNION
    SELECT mp.device_id
    FROM links l
    JOIN lt ON lt.id = l.link_type_id AND lt.name = 'HAS_METRIC'
    JOIN metric_points mp ON mp.id = l.target_object_id
    WHERE l.source_object_id IN (SELECT id FROM assets)
)
SELECT DISTINCT device_id FROM devices ORDER BY device_id
"""


# ── Subject ──────────────────────────────────────────────────────────────────

def person_object_id(prefix: str, site: int, person: int) -> uuid.UUID:
    return uuid.uuid5(UUID_NAMESPACE, f"{prefix}:person:{site:03d}:{person:02d}")


def person_name(prefix: str, site: int, person: int) -> str:
    return f"{prefix.capitalize()} Person {site:03d}-{person:02d}"


def person_email(prefix: str, site: int, person: int) -> str:
    return f"person-{site:03d}-{person:02d}@{prefix}.example.org"


# ── Data holders ─────────────────────────────────────────────────────────────

@dataclass
class Inventory:
    subject_id: uuid.UUID
    display_name: str
    tenant_id: uuid.UUID | None
    properties: dict
    residences: set[uuid.UUID]
    links_total: int
    derived_properties: int
    devices: list[str]
    rows_per_device: dict[str, int]


@dataclass
class Check:
    name: str
    expected: str
    actual: str
    ok: bool


@dataclass
class Report:
    lines: list[str] = field(default_factory=list)

    def h(self, title: str) -> None:
        self.lines.append("")
        self.lines.append(f"######## {title} ########")

    def p(self, text: str = "") -> None:
        self.lines.append(text)

    def text(self) -> str:
        return "\n".join(self.lines) + "\n"


# ── HTTP ─────────────────────────────────────────────────────────────────────

def login(core: str, email: str, password: str) -> str:
    try:
        resp = requests.post(f"{core}/api/v1/auth/login",
                             json={"email": email, "password": password}, timeout=10)
    except requests.ConnectionError:
        sys.exit(f"core-platform not reachable at {core}. Run scripts/dev.sh up first.")
    if resp.status_code != 200:
        sys.exit(f"login as {email} failed: HTTP {resp.status_code} {resp.text[:200]}")
    return resp.json()["token"]


def get(core: str, token: str, path: str, timeout: int = 120) -> requests.Response:
    return requests.get(f"{core}{path}", headers={"Authorization": f"Bearer {token}"},
                        timeout=timeout)


def delete(core: str, token: str, path: str, timeout: int = 120) -> requests.Response:
    return requests.delete(f"{core}{path}", headers={"Authorization": f"Bearer {token}"},
                           timeout=timeout)


# ── Inventory ────────────────────────────────────────────────────────────────

def read_inventory(master_dsn: str, measurement_dsn: str, subject_id: uuid.UUID) -> Inventory:
    with psycopg.connect(master_dsn) as conn:
        row = conn.execute(
            """
            SELECT o.display_name, o.tenant_id, o.properties
            FROM objects o JOIN object_types t ON t.id = o.object_type_id
            WHERE o.id = %s AND t.name = 'PERSON'
            """, (subject_id,)).fetchone()
        if row is None:
            sys.exit(f"no PERSON object {subject_id} in the master-data store. "
                     f"Seed with --persons first (see the docstring).")
        display_name, tenant_id, properties = row

        residences = {r[0] for r in conn.execute(
            """
            SELECT l.target_object_id FROM links l
            JOIN link_types lt ON lt.id = l.link_type_id AND lt.name = 'RESIDES_IN'
            WHERE l.source_object_id = %s
            """, (subject_id,)).fetchall()}

        links_total = conn.execute(
            "SELECT count(*) FROM links WHERE source_object_id = %s OR target_object_id = %s",
            (subject_id, subject_id)).fetchone()[0]

        derived = conn.execute(
            "SELECT count(*) FROM derived_properties WHERE object_id = %s",
            (subject_id,)).fetchone()[0]

        devices = [r[0] for r in conn.execute(DEVICES_SQL, (subject_id,)).fetchall()]

    rows = count_measurement_rows(measurement_dsn, devices)
    return Inventory(subject_id, display_name, tenant_id, properties or {}, residences,
                     links_total, derived, devices, rows)


def count_measurement_rows(measurement_dsn: str, devices: list[str]) -> dict[str, int]:
    if not devices:
        return {}
    with psycopg.connect(measurement_dsn) as conn:
        rows = conn.execute(
            "SELECT device_id, count(*) FROM measurements WHERE device_id = ANY(%s) GROUP BY 1",
            (devices,)).fetchall()
    counts = {d: 0 for d in devices}
    counts.update({d: int(c) for d, c in rows})
    return counts


# ── Export comparison ────────────────────────────────────────────────────────

def compare_export(inv: Inventory, export: dict) -> list[Check]:
    checks: list[Check] = []

    checks.append(Check("displayName", inv.display_name, str(export.get("displayName")),
                        export.get("displayName") == inv.display_name))

    exp_props = export.get("properties") or {}
    missing = {k: v for k, v in inv.properties.items() if exp_props.get(k) != v}
    checks.append(Check("properties (every stored key with its value)",
                        json.dumps(inv.properties, sort_keys=True),
                        json.dumps(exp_props, sort_keys=True),
                        not missing))

    exp_res = {uuid.UUID(r["spaceId"]) for r in export.get("residences") or []}
    checks.append(Check("residences (RESIDES_IN targets)",
                        f"{len(inv.residences)} space(s)",
                        f"{len(exp_res)} space(s), matching {len(exp_res & inv.residences)}",
                        exp_res == inv.residences))

    exp_dev = {d["deviceId"] for d in export.get("devices") or []}
    inv_dev = set(inv.devices)
    checks.append(Check("devices (graph walk)",
                        ", ".join(sorted(inv_dev)) or "(none)",
                        ", ".join(sorted(exp_dev)) or "(none)",
                        exp_dev == inv_dev))

    series = {s["deviceId"]: s for s in export.get("measurementSeries") or []}
    for device in sorted(inv_dev):
        want = inv.rows_per_device.get(device, 0)
        s = series.get(device)
        if s is None:
            checks.append(Check(f"series {device}", f"{want} rows", "no series in export", False))
            continue
        got_count = int(s.get("count", -1))
        got_values = len(s.get("values") or [])
        ok = got_count == want and got_values == want
        checks.append(Check(f"series {device}", f"{want} rows",
                            f"count={got_count}, values={got_values}", ok))
    return checks


def coverage_percent(checks: list[Check]) -> float:
    if not checks:
        return 0.0
    return 100.0 * sum(1 for c in checks if c.ok) / len(checks)


# ── Residual check ───────────────────────────────────────────────────────────

def run_residual_check(subject_id: uuid.UUID, name: str, email: str) -> tuple[str, dict[str, list[str]]]:
    """Runs the canonical SQL through psql in the stammdaten-db container and
    splits its unaligned output into the numbered sections of the file."""
    sql = RESIDUAL_SQL.read_text(encoding="utf-8")
    proc = subprocess.run(
        ["docker", "compose", "-f", COMPOSE_FILE, "exec", "-T", "stammdaten-db",
         "psql", "-U", "postgres", "-d", "digital_demon", "-A", "-t",
         "-v", f"subject_name={name}",
         "-v", f"subject_email={email}",
         "-v", f"subject_id='{subject_id}'",
         "-f", "-"],
        input=sql, cwd=REPO_ROOT, capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        sys.exit(f"residual check failed:\n{proc.stderr}")
    return proc.stdout, split_sections(proc.stdout)


SECTION_RE = re.compile(r"^── (\w+)\.")


def split_sections(psql_output: str) -> dict[str, list[str]]:
    sections: dict[str, list[str]] = {}
    current: str | None = None
    for line in psql_output.splitlines():
        m = SECTION_RE.match(line)
        if m:
            current = m.group(1)
            sections[current] = []
            continue
        if current is not None and line.strip():
            sections[current].append(line)
    return sections


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--prefix", default="gdpr", help="fleet prefix used at seed time (default gdpr)")
    ap.add_argument("--site", type=int, default=1)
    ap.add_argument("--person", type=int, default=1)
    ap.add_argument("--subject-id", help="measure this PERSON object instead of the deterministic one")
    ap.add_argument("--subject-name", help="display_name of the subject (only with --subject-id)")
    ap.add_argument("--subject-email", help="email of the subject (only with --subject-id)")
    ap.add_argument("--core-host", default="http://localhost:8080")
    ap.add_argument("--admin-email", default="admin@local")
    ap.add_argument("--admin-password", default="admin")
    ap.add_argument("--master-dsn", default="postgresql://postgres:password@localhost:5432/digital_demon")
    ap.add_argument("--measurement-dsn",
                    default="postgresql://postgres:password@localhost:5433/digital_demon_measurements")
    ap.add_argument("--results-dir", default=str(REPO_ROOT / "evaluation" / "results"))
    ap.add_argument("--skip-erase", action="store_true", help="stop after the export comparison")
    args = ap.parse_args()

    if args.subject_id:
        subject_id = uuid.UUID(args.subject_id)
        name = args.subject_name or ""
        email = args.subject_email or ""
    else:
        subject_id = person_object_id(args.prefix, args.site, args.person)
        name = person_name(args.prefix, args.site, args.person)
        email = person_email(args.prefix, args.site, args.person)

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    results = Path(args.results_dir)
    results.mkdir(parents=True, exist_ok=True)
    report_path = results / f"qs-sec-02-{stamp}.txt"
    export_path = results / f"qs-sec-02-{stamp}-export.json"

    rep = Report()
    rep.p("scenario  : qs-sec-02")
    rep.p(f"started   : {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S+00')}")
    rep.p(f"subject   : {subject_id}  ({name or 'name not given'})")
    rep.p(f"core      : {args.core_host}")
    t_start = time.perf_counter()

    # 1. inventory ──────────────────────────────────────────────────────────
    inv = read_inventory(args.master_dsn, args.measurement_dsn, subject_id)
    if name == "":
        name = inv.display_name
    if email == "":
        email = str(inv.properties.get("email", ""))
    rep.h("1 reference inventory (master-data store + measurement store)")
    rep.p(f"display_name        : {inv.display_name}")
    rep.p(f"tenant_id           : {inv.tenant_id}")
    rep.p(f"properties          : {json.dumps(inv.properties, sort_keys=True)}")
    rep.p(f"residences          : {len(inv.residences)}")
    rep.p(f"links touching it   : {inv.links_total}")
    rep.p(f"derived_properties  : {inv.derived_properties}")
    rep.p(f"devices via graph   : {len(inv.devices)}")
    for d in inv.devices:
        rep.p(f"  {d:<28} {inv.rows_per_device.get(d, 0):>8} measurement rows")
    if inv.devices and sum(inv.rows_per_device.values()) == 0:
        rep.p("WARNING: no measurement rows for these devices. Run some telemetry first, "
              "otherwise the series part of the coverage is vacuous.")

    # 2. export ─────────────────────────────────────────────────────────────
    token = login(args.core_host, args.admin_email, args.admin_password)
    t0 = time.perf_counter()
    resp = get(args.core_host, token, f"/api/v1/privacy/persons/{subject_id}/export")
    export_seconds = time.perf_counter() - t0
    rep.h("2 export (Art. 15)")
    rep.p(f"HTTP {resp.status_code} in {export_seconds:.2f} s")
    if resp.status_code != 200:
        rep.p(resp.text[:500])
        report_path.write_text(rep.text(), encoding="utf-8")
        print(rep.text())
        return 1
    export = resp.json()
    export_path.write_text(json.dumps(export, indent=2), encoding="utf-8")
    rep.p(f"saved verbatim to {export_path.name}")

    checks = compare_export(inv, export)
    rep.p("")
    for c in checks:
        rep.p(f"[{'ok' if c.ok else 'MISMATCH'}] {c.name}")
        rep.p(f"       expected  {c.expected}")
        rep.p(f"       exported  {c.actual}")
    cov = coverage_percent(checks)
    rep.p("")
    rep.p(f"coverage: {cov:.1f} %  ({sum(1 for c in checks if c.ok)}/{len(checks)} items)   target 100 %")
    if cov < 100.0 and any(not c.ok and c.name.startswith("series") for c in checks):
        rep.p("hint: a series mismatch usually means telemetry was still running "
              "between inventory and export. Let the generator finish, re-run.")

    if args.skip_erase:
        rep.h("erasure skipped (--skip-erase)")
        report_path.write_text(rep.text(), encoding="utf-8")
        print(rep.text())
        return 0 if cov == 100.0 else 1

    # 3. erase ──────────────────────────────────────────────────────────────
    t0 = time.perf_counter()
    resp = delete(args.core_host, token, f"/api/v1/privacy/persons/{subject_id}")
    erase_seconds = time.perf_counter() - t0
    rep.h("3 erasure (Art. 17)")
    rep.p(f"HTTP {resp.status_code} in {erase_seconds:.2f} s")
    if resp.status_code != 200:
        rep.p(resp.text[:500])
        report_path.write_text(rep.text(), encoding="utf-8")
        print(rep.text())
        return 1
    erasure = resp.json()
    rep.p(f"deletedLinks              : {erasure.get('deletedLinks')}   (inventory said {inv.links_total})")
    retained = erasure.get("retainedMeasurementsByDevice") or {}
    rep.p(f"retainedMeasurementsByDevice: {json.dumps(retained, sort_keys=True)}")
    rep.p(f"retentionNote             : {erasure.get('retentionNote')}")

    # 4. residual check ─────────────────────────────────────────────────────
    raw, sections = run_residual_check(subject_id, name, email)
    rep.h("4 residual check (evaluation/sql/privacy-residual-check.sql, verbatim)")
    rep.p(raw.rstrip())
    finding_rows = sum(len(sections.get(s, [])) for s in RESIDUAL_FINDING_SECTIONS)
    expected_rows = {s: sections.get(s, []) for s in RESIDUAL_EXPECTED_SECTIONS}
    rep.p("")
    rep.p(f"residual hits in finding sections 1-6 : {finding_rows}   target 0")
    for s, rows in expected_rows.items():
        rep.p(f"section {s} (expected, audit trail)     : {' '.join(rows) or '0'}")

    # 5. re-query ───────────────────────────────────────────────────────────
    rep.h("5 re-query after erasure")
    r1 = get(args.core_host, token, f"/api/v1/privacy/persons/{subject_id}/export")
    # The links endpoint does not check existence, it answers 200 with empty
    # lists for an unknown id. That is fine here: zero links left is exactly
    # the cascade evidence, so both 404 and "200, nothing" count as clean.
    r2 = get(args.core_host, token, f"/api/v1/objects/{subject_id}/links")
    links_left: int | None = None
    if r2.status_code == 200:
        body = r2.json()
        links_left = len(body.get("outbound") or []) + len(body.get("inbound") or [])
    rep.p(f"GET privacy export   : HTTP {r1.status_code}   target 404")
    rep.p(f"GET object links     : HTTP {r2.status_code}, links left {links_left if links_left is not None else 'n/a'}   target 0 (or 404)")
    after = count_measurement_rows(args.measurement_dsn, inv.devices)
    unchanged = after == inv.rows_per_device
    rep.p(f"measurement rows unchanged after erasure: {'yes' if unchanged else 'NO'}")
    for d in inv.devices:
        rep.p(f"  {d:<28} before {inv.rows_per_device.get(d, 0):>8}   after {after.get(d, 0):>8}")
    rep.p("These rows persist WITHOUT a subject reference. That is the deliberate "
          "deviation from the ch. 4 design (series severed, not deleted) and the "
          "QA-SEC vs QA-INT trade-off for ch. 6.")

    # verdict ───────────────────────────────────────────────────────────────
    total_seconds = time.perf_counter() - t_start
    requery_ok = r1.status_code == 404 and (r2.status_code == 404 or links_left == 0)
    rep.h("verdict")
    rep.p(f"export coverage         : {cov:.1f} %              target 100 %      {'ok' if cov == 100.0 else 'FAIL'}")
    rep.p(f"residual hits           : {finding_rows}                    target 0          {'ok' if finding_rows == 0 else 'FAIL'}")
    rep.p(f"re-query                : export {r1.status_code}, links left {links_left if links_left is not None else r2.status_code}   target 404 / 0   {'ok' if requery_ok else 'FAIL'}")
    rep.p(f"erasure call            : {erase_seconds:.2f} s")
    rep.p(f"whole run               : {total_seconds:.1f} s              target < 900 s    {'ok' if total_seconds < 900 else 'FAIL'}")
    rep.p(f"measurements retained   : {sum(after.values())} rows in {len(inv.devices)} series, unchanged={'yes' if unchanged else 'NO'}")
    passed = cov == 100.0 and finding_rows == 0 and requery_ok and total_seconds < 900
    rep.p("")
    rep.p("RESULT: " + ("all response measures met" if passed else "NOT met, see above"))
    rep.p("Re-seeding recreates the subject for another run.")

    report_path.write_text(rep.text(), encoding="utf-8")
    print(rep.text())
    print(f"report: {report_path}")
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
