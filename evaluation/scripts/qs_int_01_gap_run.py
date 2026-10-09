#!/usr/bin/env python3
"""QS-INT-01: a sensor outage must stay visible as a gap.

Response measure (thesis ch. 3): "Persistiert gleich empfangen (Verlustrate
0 %), 0 Datenpunkte innerhalb der Lücke in Speicher UND API-Antwort", over
"10.000 gesendete Messwerte mit einer definierten Lücke".

The scenario is the counter-test to every telemetry platform that smooths its
series. A correct platform shows a hole where the sensor went silent. One that
back-fills, carries the last value forward or interpolates shows none, and
destroys exactly the diagnostic information the domain needs (ch. 3, QA-INT).
So the failure this run looks for is not missing data, it is INVENTED data.

What one run does:

  1. seed       A dedicated fleet under its own prefix, so the fleets of the
                load scenarios stay untouched.
  2. generate   One run with --fault dropout on a single room sensor. That
                device simply stops publishing for the requested span, which is
                what a flat battery or a lost radio link looks like on the wire.
                The generator's own final line reports how many measurements it
                published, which is the "empfangen" side of the loss rate.
  3. store      Persisted rows in the window, compared against the generator's
                count -> loss rate, target 0 %.
  4. gap        The gap is DETECTED in the data rather than assumed: the script
                looks for an interval larger than three times the channel's own
                median cadence, then checks that it matches the injected one.
                Rows strictly inside it must be 0.
  5. isolation  The neighbouring channels must have kept reporting in the same
                window. Otherwise the hole is a platform stall, not the
                simulated outage, and the scenario would be measuring nothing.
  6. API        The same window through the analytics timeseries API. No bucket
                may fall inside the gap. This is the second half of the response
                measure and the half that a storage-only check cannot answer,
                because interpolation would happen on the read path.

Preconditions:
  - scripts/dev.sh up
  - the evaluation venv with requests and psycopg (see evaluation/README.md)

The fleet is seeded by this script. Device selection for the fault is
deterministic (mock-service takes the first matching device in fleet order),
so the faulted channel is always <prefix>-ht-001-01, metric 1. The script
verifies that empirically rather than trusting it.

Usage:
    .venv/bin/python qs_int_01_gap_run.py
    .venv/bin/python qs_int_01_gap_run.py --rooms 10 --target-measurements 10000
    .venv/bin/python qs_int_01_gap_run.py --skip-generate --start '...' --end '...'
"""

from __future__ import annotations

import argparse
import csv
import math
import re
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

import psycopg
import requests

REPO_ROOT = Path(__file__).resolve().parents[2]
MOCK = REPO_ROOT / "applications" / "mock-service" / ".venv" / "bin" / "mock-service"

# "run finished: published=%d measurements=%d (seeded=%d) dropped=%d errors=%d"
SUMMARY_RE = re.compile(
    r"run finished: published=(\d+) measurements=(\d+) \(seeded=(\d+)\) "
    r"dropped=(\d+) errors=(\d+)"
)

# A gap is an interval this many times longer than the channel's own median
# cadence. Relative, so it works for any --interval without hardcoding one.
GAP_FACTOR = 3.0

# Bucket widths the analytics API accepts (db/queries.py resolve_bucket). The
# API check is only meaningful when whole buckets fit INSIDE the gap, so the
# run refuses a combination where they do not.
BUCKET_SECONDS = {"1min": 60, "5min": 300, "15min": 900,
                  "1h": 3600, "6h": 21600, "1d": 86400}


@dataclass
class Generated:
    published: int = 0
    measurements: int = 0
    seeded: int = 0
    dropped: int = 0
    errors: int = 0


@dataclass
class Gap:
    starts_at: datetime
    ends_at: datetime
    seconds: float
    cadence_seconds: float


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


# ── Fleet arithmetic ─────────────────────────────────────────────────────────

def measurements_per_tick(rooms: int) -> float:
    """Boiler carries 4 metrics in one message, each room sensor 2 per tick
    plus a battery reading every tenth tick (see evaluation/README.md)."""
    return 4 + 2 * rooms + rooms / 10.0


def outage_shortfall(gap_for: int, interval: float) -> int:
    """Measurements the injected outage removes from the offered total.

    The faulted room sensor carries two metrics per tick, so a gap of n seconds
    costs 2 * n / interval measurements. Without compensating for it a run
    configured for 10.000 delivers visibly fewer, and the scenario's
    "10.000 gesendete Messwerte" would be missed by construction.
    """
    return int(round(2 * gap_for / interval))


def duration_for(target: int, rooms: int, interval: float, gap_for: int = 0) -> int:
    per_tick = measurements_per_tick(rooms)
    ticks = math.ceil((target + outage_shortfall(gap_for, interval)) / per_tick)
    return max(30, int(math.ceil(ticks * interval)))


# ── Steps ────────────────────────────────────────────────────────────────────

def seed(prefix: str, sites: int, rooms: int, dsn: str) -> None:
    proc = subprocess.run(
        [str(MOCK), "seed", "--prefix", prefix, "--sites", str(sites),
         "--rooms", str(rooms), "--dsn", dsn],
        capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        sys.exit(f"seeding failed:\n{proc.stdout}\n{proc.stderr}")
    print(f"    {proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else 'seeded'}")


def generate(prefix: str, sites: int, rooms: int, interval: float, duration: int,
             gap_at: int, gap_for: int, broker: str) -> Generated:
    """One run with a dropout fault on the first room sensor."""
    cmd = [str(MOCK), "run", "--prefix", prefix, "--sites", str(sites),
           "--rooms", str(rooms), "--interval", str(interval),
           "--duration", str(duration), "--broker", broker,
           "--fault", f"dropout:target=rooms,count=1,at={gap_at},for={gap_for}"]
    print("    " + " ".join(cmd[1:]))
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    blob = proc.stdout + proc.stderr
    m = SUMMARY_RE.search(blob)
    if not m:
        sys.exit(f"generator produced no summary line, cannot compute a loss "
                 f"rate:\n{blob[-1500:]}")
    g = Generated(*(int(x) for x in m.groups()))
    if g.dropped or g.errors:
        print(f"    WARNING: generator dropped={g.dropped} errors={g.errors}. "
              f"The offered load was not fully delivered; this is a generator "
              f"figure, not a platform loss.")
    return g


def persisted_in_window(dsn: str, prefix: str, start: datetime, end: datetime) -> int:
    """Rows the store accepted in the window, filtered on received_at.

    Deliberately not on `time`: a deviating device clock could otherwise pull
    rows out of a window the platform did in fact accept them in.
    """
    with psycopg.connect(dsn) as conn:
        return conn.execute(
            "SELECT count(*) FROM measurements "
            "WHERE device_id LIKE %s AND received_at >= %s AND received_at < %s",
            (f"{prefix}-%", start, end)).fetchone()[0]


def find_gap(dsn: str, device: str, metric: int,
             start: datetime, end: datetime) -> tuple[Gap | None, float, int]:
    """Largest interval exceeding GAP_FACTOR times the channel's median cadence."""
    with psycopg.connect(dsn) as conn:
        rows = conn.execute(
            "SELECT time FROM measurements "
            "WHERE device_id = %s AND metric_id = %s AND time >= %s AND time < %s "
            "ORDER BY time", (device, metric, start, end)).fetchall()
    times = [r[0] for r in rows]
    if len(times) < 3:
        return None, 0.0, len(times)
    deltas = [(times[i] - times[i - 1]).total_seconds() for i in range(1, len(times))]
    ordered = sorted(deltas)
    median = ordered[len(ordered) // 2]
    widest = max(deltas)
    if widest <= GAP_FACTOR * median:
        return None, median, len(times)
    i = deltas.index(widest)
    return Gap(times[i], times[i + 1], widest, median), median, len(times)


def rows_inside(dsn: str, device: str, metric: int, gap: Gap) -> int:
    with psycopg.connect(dsn) as conn:
        return conn.execute(
            "SELECT count(*) FROM measurements "
            "WHERE device_id = %s AND metric_id = %s AND time > %s AND time < %s",
            (device, metric, gap.starts_at, gap.ends_at)).fetchone()[0]


def neighbours(dsn: str, prefix: str, device: str, metric: int,
               start: datetime, end: datetime) -> list[tuple]:
    with psycopg.connect(dsn) as conn:
        return conn.execute(
            "SELECT device_id, count(*), min(time), max(time) FROM measurements "
            "WHERE device_id LIKE %s AND device_id <> %s AND metric_id = %s "
            "  AND time >= %s AND time < %s "
            "GROUP BY device_id ORDER BY device_id",
            (f"{prefix}-%", device, metric, start, end)).fetchall()


def metric_point_id(master_dsn: str, device: str, metric: int) -> str | None:
    with psycopg.connect(master_dsn) as conn:
        row = conn.execute(
            "SELECT id FROM metric_points WHERE device_id = %s AND metric_id = %s",
            (device, metric)).fetchone()
    return str(row[0]) if row else None


def api_series(core: str, analytics: str, email: str, password: str,
               mp_id: str, start: datetime, end: datetime,
               resample: str) -> list[tuple[int, float | None]]:
    """The same window through the read path. Returns (epoch, value) buckets."""
    r = requests.post(f"{core}/api/v1/auth/login",
                      json={"email": email, "password": password}, timeout=10)
    if r.status_code != 200:
        sys.exit(f"login failed: HTTP {r.status_code} {r.text[:200]}")
    token = r.json()["token"]
    r = requests.post(
        f"{analytics}/stats/timeseries",
        headers={"Authorization": f"Bearer {token}"},
        json={"metric_point_ids": [mp_id],
              "time_range": {"start": int(start.timestamp()), "end": int(end.timestamp())},
              "resample": resample, "aggregation": "mean"},
        timeout=60)
    if r.status_code != 200:
        sys.exit(f"timeseries query failed: HTTP {r.status_code} {r.text[:300]}")
    body = r.json()
    series = body.get("series") or []
    if not series:
        return []
    # The field is `values` (models/responses.py TimeseriesSeries). Reading a
    # wrong key here returns an empty list and makes the whole API check pass
    # without testing anything, which is exactly how the first run of this
    # script reported a vacuous success.
    return [(p["time"], p.get("value")) for p in series[0].get("values", [])]


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--prefix", default="gap", help="fleet prefix (default gap)")
    ap.add_argument("--sites", type=int, default=1)
    ap.add_argument("--rooms", type=int, default=3,
                    help="rooms per site; 3 matches the fleet shape of the load scenarios")
    ap.add_argument("--interval", type=float, default=0.5)
    ap.add_argument("--target-measurements", type=int, default=10000,
                    help="scenario asks for 10.000; the duration follows from it")
    ap.add_argument("--gap-at", type=int, default=60, help="outage starts after n s")
    ap.add_argument("--gap-for", type=int, default=300, help="outage lasts n s")
    ap.add_argument("--resample", default="1min", choices=sorted(BUCKET_SECONDS),
                    help="bucket width for the API check, must be well below --gap-for")
    ap.add_argument("--broker", default="localhost:1883")
    ap.add_argument("--core-host", default="http://localhost:8080")
    ap.add_argument("--analytics-host", default="http://localhost:8100")
    ap.add_argument("--admin-email", default="admin@local")
    ap.add_argument("--admin-password", default="admin")
    ap.add_argument("--master-dsn",
                    default="postgresql://postgres:password@localhost:5432/heating_platform")
    ap.add_argument("--measurement-dsn",
                    default="postgresql://postgres:password@localhost:5433/heating_platform_measurements")
    ap.add_argument("--results-dir",
                    default=str(REPO_ROOT / "evaluation" / "results" / "qs-int-01"))
    ap.add_argument("--skip-seed", action="store_true")
    ap.add_argument("--sweep-wait", type=int, default=40,
                    help="seconds to wait for device-management to publish device.configured")
    args = ap.parse_args()

    if args.gap_for <= 0:
        sys.exit("--gap-for must be positive, otherwise there is no gap to find")
    duration = duration_for(args.target_measurements, args.rooms, args.interval,
                            args.gap_for)
    bucket_s = BUCKET_SECONDS[args.resample]
    if args.gap_for < 2 * bucket_s:
        sys.exit(f"--gap-for {args.gap_for}s is too short for --resample "
                 f"{args.resample} ({bucket_s}s): no whole bucket would fall inside "
                 f"the gap, so the API half could not distinguish an open gap from "
                 f"an empty answer. Use a longer gap or a finer bucket.")
    if args.gap_at + args.gap_for >= duration:
        sys.exit(f"the outage ({args.gap_at}+{args.gap_for}s) would run past the end of "
                 f"the {duration}s run, so it would be a truncation and not a gap. "
                 f"Lower --gap-at/--gap-for or raise --target-measurements.")

    faulted = f"{args.prefix}-ht-001-01"   # first room sensor in fleet order
    metric = 1                              # room temperature
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out = Path(args.results_dir)
    out.mkdir(parents=True, exist_ok=True)

    rep = Report()
    rep.p("scenario  : qs-int-01")
    rep.p(f"started   : {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S+00')}")
    rep.p(f"fleet     : prefix '{args.prefix}', {args.sites} site(s) x {args.rooms} rooms, "
          f"interval {args.interval}s, duration {duration}s")
    rep.p(f"outage    : {faulted} metric {metric}, from +{args.gap_at}s for {args.gap_for}s")

    if not args.skip_seed:
        print("==> seeding the fleet")
        seed(args.prefix, args.sites, args.rooms, args.master_dsn)
        print(f"==> waiting {args.sweep_wait}s for the device.configured sweep")
        time.sleep(args.sweep_wait)

    print("==> generating telemetry with the injected outage")
    start = datetime.now(timezone.utc)
    gen = generate(args.prefix, args.sites, args.rooms, args.interval, duration,
                   args.gap_at, args.gap_for, args.broker)
    end = datetime.now(timezone.utc) + timedelta(seconds=5)

    # 1. loss rate ──────────────────────────────────────────────────────────
    persisted = persisted_in_window(args.measurement_dsn, args.prefix, start, end)
    loss = 1 - (persisted / gen.seeded) if gen.seeded else 1.0
    rep.h("1 loss rate (generated against persisted)")
    rep.p(f"generator published   : {gen.published} messages, {gen.measurements} measurements")
    rep.p(f"thereof commissioned  : {gen.seeded} measurements   (the expected row count)")
    rep.p(f"generator dropped     : {gen.dropped}, publish errors {gen.errors}")
    rep.p(f"persisted in window   : {persisted}")
    rep.p(f"loss rate             : {loss * 100:.4f} %   target 0 %")
    rep.p(f"scenario asks for     : {args.target_measurements} sent measurements")
    if gen.seeded < args.target_measurements:
        rep.p(f"NOTE: {gen.seeded} is below that. The run length already compensates "
              f"for the {outage_shortfall(args.gap_for, args.interval)} measurements "
              f"the outage removes, so a remaining shortfall points at the generator, "
              f"not at the scenario.")

    # 2. the gap ────────────────────────────────────────────────────────────
    gap, cadence, samples = find_gap(args.measurement_dsn, faulted, metric, start, end)
    rep.h("2 the gap, detected in the data and not assumed")
    rep.p(f"channel               : {faulted}, metric {metric}")
    rep.p(f"values in the window  : {samples}")
    rep.p(f"median cadence        : {cadence:.2f} s")
    if gap is None:
        rep.p("NO GAP FOUND. Either the outage did not reach the platform, or the "
              "platform closed the hole. Both are failures of this scenario, and "
              "the neighbour check below says which.")
    else:
        rep.p(f"gap starts after      : {gap.starts_at.isoformat()}")
        rep.p(f"gap ends before       : {gap.ends_at.isoformat()}")
        rep.p(f"gap length            : {gap.seconds:.1f} s   (injected {args.gap_for} s)")
        drift = abs(gap.seconds - args.gap_for)
        rep.p(f"deviation from injected: {drift:.1f} s "
              f"({'plausible' if drift <= 3 * max(cadence, args.interval) else 'CHECK THIS'})")

    # 3. values inside the gap ──────────────────────────────────────────────
    inside = rows_inside(args.measurement_dsn, faulted, metric, gap) if gap else -1
    rep.h("3 values inside the gap, in the store")
    if gap is None:
        rep.p("not applicable, no gap was found")
    else:
        rep.p(f"rows strictly inside  : {inside}   target 0")
        if inside:
            rep.p("Any row here means the platform invented data for a time at which "
                  "the sensor was silent. That is the outright failure of QS-INT-01.")

    # 4. isolation ──────────────────────────────────────────────────────────
    others = neighbours(args.measurement_dsn, args.prefix, faulted, metric, start, end)
    rep.h("4 neighbouring channels (isolates the outage from a platform stall)")
    healthy = 0
    for device, count, first, last in others:
        span = (last - first).total_seconds() if first and last else 0
        ok = count > 0 and span > args.gap_for
        healthy += 1 if ok else 0
        rep.p(f"  {device:<26} {count:>6} values   {first} .. {last}")
    rep.p(f"channels that kept reporting across the outage: {healthy} of {len(others)}")
    if gap and healthy == 0:
        rep.p("WARNING: no neighbour reported through the window either. The hole is "
              "then a platform-wide stall and this run measures nothing.")

    # 5. the API half ───────────────────────────────────────────────────────
    rep.h("5 the same window through the analytics API")
    mp_id = metric_point_id(args.master_dsn, faulted, metric)
    api_inside = -1
    api_before = api_after = 0
    points: list[tuple[int, float | None]] = []
    if mp_id is None:
        rep.p(f"no metric point registered for {faulted}/{metric}, API half skipped")
    else:
        points = api_series(args.core_host, args.analytics_host, args.admin_email,
                            args.admin_password, mp_id, start, end, args.resample)
        rep.p(f"metric point          : {mp_id}")
        rep.p(f"resample              : {args.resample} ({bucket_s} s per bucket)")
        rep.p(f"buckets returned      : {len(points)}")
        non_null = sum(1 for _, v in points if v is not None)
        rep.p(f"thereof with a value  : {non_null}")
        if gap is not None:
            lo, hi = gap.starts_at.timestamp(), gap.ends_at.timestamp()
            # A bucket counts as inside only if it lies WHOLLY within the gap.
            # A bucket straddling an edge legitimately carries data from the
            # healthy side and would otherwise be read as invented.
            inside_pts = [(t, v) for t, v in points
                          if v is not None and t >= lo and t + bucket_s <= hi]
            api_inside = len(inside_pts)
            api_before = sum(1 for t, v in points if v is not None and t + bucket_s <= lo)
            api_after = sum(1 for t, v in points if v is not None and t >= hi)
            rep.p(f"buckets before the gap: {api_before}")
            rep.p(f"buckets inside the gap: {api_inside}   target 0")
            rep.p(f"buckets after the gap : {api_after}")
            for t, v in inside_pts[:10]:
                rep.p(f"    {datetime.fromtimestamp(t, timezone.utc).isoformat()}  {v}")
            if api_inside:
                rep.p("The read path produced values for a silent period. That is "
                      "interpolation or carry-forward, which QS-INT-01 forbids.")
            elif api_before and api_after:
                rep.p("The series carries values on both sides of the outage and none "
                      "within it. The read path leaves the hole open rather than "
                      "closing it.")
            else:
                rep.p("VACUOUS. The answer does not cover both sides of the outage, so "
                      "an absent bucket proves nothing here. An empty or one-sided "
                      "answer would look identical to a correctly open gap.")

        csv_path = out / f"qs-int-01-{stamp}-series.csv"
        with open(csv_path, "w", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(["bucket_epoch", "bucket_utc", "value", "inside_gap"])
            for t, v in points:
                in_gap = bool(gap and gap.starts_at.timestamp() < t < gap.ends_at.timestamp())
                w.writerow([t, datetime.fromtimestamp(t, timezone.utc).isoformat(),
                            "" if v is None else v, in_gap])
        rep.p(f"series written to {csv_path.name}")

    # verdict ───────────────────────────────────────────────────────────────
    rep.h("verdict")
    checks = [
        ("loss rate 0 %", loss == 0.0, f"{loss * 100:.4f} %"),
        ("a gap is present", gap is not None, "found" if gap else "NOT FOUND"),
        ("0 values inside the gap, store", gap is not None and inside == 0, str(inside)),
        ("0 values inside the gap, API", gap is not None and api_inside == 0, str(api_inside)),
        ("API answer spans the outage", bool(api_before and api_after),
         f"{api_before} before, {api_after} after"),
        ("outage isolated to one channel", healthy > 0, f"{healthy} neighbours healthy"),
    ]
    for name, ok, actual in checks:
        rep.p(f"[{'ok' if ok else 'FAIL'}] {name:<34} {actual}")
    passed = all(ok for _, ok, _ in checks)
    rep.p("")
    rep.p("RESULT: " + ("all response measures met" if passed else "NOT met, see above"))
    rep.p("")
    rep.p("Reading note. The scenario asks for the ABSENCE of invented data, so a "
          "pass is the absence of rows and buckets, not their presence. The "
          "neighbour check is what keeps that absence meaningful.")

    path = out / f"qs-int-01-{stamp}.txt"
    path.write_text(rep.text(), encoding="utf-8")
    print(rep.text())
    print(f"report: {path}")
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
