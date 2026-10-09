#!/usr/bin/env python3
"""QS-INT-02: provenance of persisted measurements.

Response measure (thesis ch. 3): "100 % der persistierten Werte tragen Gerät,
Metrik, Mess- und Empfangszeitpunkt, Stichprobe von 100 Werten bis zur
Roh-Payload rückverfolgbar."

Five checks, and the last two are the ones that make this more than a NOT NULL
query:

  1. completeness   All four provenance fields present on every row in the
                    window. Target 100 %.
  2. registry       Every distinct (device_id, metric_id) in the measurement
                    store resolves to a registered metric point in the MASTER
                    store. An orphan is a value whose origin the platform can
                    no longer name, which is a provenance failure even though
                    all four fields are filled. This crosses two databases and
                    is therefore the one check the plain SQL script cannot do.
  3. traceability   A deterministic sample of 100 rows, each resolved back to
                    the MQTT topic and the JSON field it came from. That chain
                    is what "bis zur Roh-Payload" means for a value that was
                    parsed successfully: the raw bytes are not kept for good
                    payloads, but the route to them is reconstructible.
  4. error path     Payloads that FAILED to parse are kept verbatim in
                    ingestion_errors. Nothing is dropped silently, which is the
                    other half of provenance and is easy to overlook.
  5. independence   The honest caveat, quantified rather than hidden: on the
                    Shelly route the measurement time and the receive time
                    carry the same value, because those payloads have no device
                    clock. The four fields are present, but the two timestamps
                    are not independent there. The share is reported per device
                    family instead of being averaged away.

Not testable at the prototype, and stated as a limit rather than passed over:
the calibration (Eichung) of a measuring device under RB-REG-04. All devices
here are simulated and none is calibrated, so that part of the scenario is
constructively fulfilled by the data model and empirically unmeasured.

Window: defaults to the last --minutes of data. Pass --start/--end to evaluate
a specific run, for instance the window of a QS-PER-01 measurement.

Usage:
    .venv/bin/python qs_int_02_provenance_run.py
    .venv/bin/python qs_int_02_provenance_run.py --minutes 60 --prefix tenanta
    .venv/bin/python qs_int_02_provenance_run.py \
        --start '2026-09-02 11:06:34+00' --end '2026-09-02 11:36:58+00'
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

import psycopg

REPO_ROOT = Path(__file__).resolve().parents[2]

SAMPLE_SIZE = 100


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


def topic_for(device_id: str, source: str) -> str:
    """Rebuild the MQTT topic a value arrived on.

    The generic route publishes one document to <device>/data; the Shelly route
    publishes one object per channel to <device>/status/<source>. The registry's
    `source` column is what distinguishes them (see evaluation/README.md).
    """
    if source == "data":
        return f"{device_id}/data"
    return f"{device_id}/status/{source}"


def resolve_window(dsn: str, like: str, args) -> tuple[datetime, datetime]:
    if args.start and args.end:
        with psycopg.connect(dsn) as conn:
            row = conn.execute("SELECT %s::timestamptz, %s::timestamptz",
                               (args.start, args.end)).fetchone()
        return row[0], row[1]
    with psycopg.connect(dsn) as conn:
        row = conn.execute(
            "SELECT max(received_at) FROM measurements WHERE device_id LIKE %s",
            (like,)).fetchone()
    latest = row[0]
    if latest is None:
        sys.exit(f"no measurements for devices matching '{like}'. Ingest some "
                 f"telemetry first, or pass --start/--end.")
    return latest - timedelta(minutes=args.minutes), latest + timedelta(seconds=1)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--prefix", default="",
                    help="restrict to one fleet's devices (default: all)")
    ap.add_argument("--minutes", type=int, default=30,
                    help="window length ending at the newest row (default 30)")
    ap.add_argument("--start", help="explicit window start, e.g. '2026-09-02 11:06:34+00'")
    ap.add_argument("--end", help="explicit window end")
    ap.add_argument("--master-dsn",
                    default="postgresql://postgres:password@localhost:5432/heating_platform")
    ap.add_argument("--measurement-dsn",
                    default="postgresql://postgres:password@localhost:5433/heating_platform_measurements")
    ap.add_argument("--results-dir",
                    default=str(REPO_ROOT / "evaluation" / "results" / "qs-int-02"))
    args = ap.parse_args()

    like = f"{args.prefix}-%" if args.prefix else "%"
    start, end = resolve_window(args.measurement_dsn, like, args)

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out = Path(args.results_dir)
    out.mkdir(parents=True, exist_ok=True)

    rep = Report()
    rep.p("scenario  : qs-int-02")
    rep.p(f"started   : {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S+00')}")
    rep.p(f"window    : {start.isoformat()} .. {end.isoformat()}")
    rep.p(f"devices   : {'prefix ' + args.prefix if args.prefix else 'all'}")

    with psycopg.connect(args.measurement_dsn) as m:
        # 1. completeness ───────────────────────────────────────────────────
        total, miss_dev, miss_met, miss_time, miss_recv = m.execute(
            """
            SELECT count(*),
                   count(*) FILTER (WHERE device_id   IS NULL),
                   count(*) FILTER (WHERE metric_id   IS NULL),
                   count(*) FILTER (WHERE time        IS NULL),
                   count(*) FILTER (WHERE received_at IS NULL)
            FROM measurements
            WHERE device_id LIKE %s AND received_at >= %s AND received_at < %s
            """, (like, start, end)).fetchone()
        complete = total - max(miss_dev, miss_met, miss_time, miss_recv) if total else 0
        pct = (100.0 * (total - (miss_dev + miss_met + miss_time + miss_recv)) / total) if total else 0.0

        rep.h("1 completeness of the four provenance fields")
        rep.p(f"rows in window        : {total}")
        rep.p(f"missing device_id     : {miss_dev}")
        rep.p(f"missing metric_id     : {miss_met}")
        rep.p(f"missing measured time : {miss_time}")
        rep.p(f"missing received_at   : {miss_recv}")
        rep.p(f"complete              : {pct:.2f} %   target 100 %")
        if total == 0:
            rep.p("No rows in the window. Nothing can be concluded from this run.")

        # 2. registry resolution ────────────────────────────────────────────
        pairs = m.execute(
            """
            SELECT device_id, metric_id, count(*)
            FROM measurements
            WHERE device_id LIKE %s AND received_at >= %s AND received_at < %s
            GROUP BY device_id, metric_id ORDER BY device_id, metric_id
            """, (like, start, end)).fetchall()

    with psycopg.connect(args.master_dsn) as s:
        registry_rows = s.execute(
            "SELECT device_id, metric_id, id, source, field, unit FROM metric_points"
        ).fetchall()
    registry = {(d, int(mi)): (str(i), src, fld, unit)
                for d, mi, i, src, fld, unit in registry_rows}

    orphans = [(d, mi, c) for d, mi, c in pairs if (d, int(mi)) not in registry]
    rep.h("2 every value resolves to a registered metric point")
    rep.p(f"distinct channels     : {len(pairs)}")
    rep.p(f"resolved in registry  : {len(pairs) - len(orphans)}")
    rep.p(f"orphans               : {len(orphans)}   target 0")
    for d, mi, c in orphans[:10]:
        rep.p(f"    {d} metric {mi}, {c} values with no registry entry")
    if orphans:
        rep.p("An orphan carries all four fields but the platform can no longer "
              "name what it measured. That is a provenance failure even though "
              "check 1 passes, which is why this check exists separately.")

    # 3. traceability sample ────────────────────────────────────────────────
    with psycopg.connect(args.measurement_dsn) as m:
        sample = m.execute(
            """
            SELECT device_id, metric_id, value, time, received_at, persisted_at
            FROM measurements
            WHERE device_id LIKE %s AND received_at >= %s AND received_at < %s
            ORDER BY received_at, device_id, metric_id
            LIMIT %s
            """, (like, start, end, SAMPLE_SIZE)).fetchall()

    traced = 0
    sample_path = out / f"qs-int-02-{stamp}-sample.csv"
    with open(sample_path, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["device_id", "metric_id", "value", "measured_at", "received_at",
                    "persisted_at", "ingest_ms", "metric_point_id", "mqtt_topic",
                    "payload_field", "unit", "traceable"])
        for dev, mid, val, t, recv, pers in sample:
            entry = registry.get((dev, int(mid)))
            ok = entry is not None
            traced += 1 if ok else 0
            mp_id, src, fld, unit = entry if ok else ("", "", "", "")
            ingest_ms = round((pers - recv).total_seconds() * 1000, 1) if recv and pers else ""
            w.writerow([dev, mid, val, t.isoformat() if t else "",
                        recv.isoformat() if recv else "", pers.isoformat() if pers else "",
                        ingest_ms, mp_id, topic_for(dev, src) if ok else "", fld, unit, ok])

    rep.h("3 traceability of a sample of 100 values")
    rep.p(f"sampled               : {len(sample)}   (deterministic, ordered by receipt)")
    rep.p(f"traceable to topic and payload field : {traced}   target {len(sample)}")
    rep.p(f"written to {sample_path.name}")
    rep.p("Each row names the MQTT topic and the JSON field the value was parsed "
          "from, which is the route back to the raw payload. The raw bytes of a "
          "SUCCESSFUL payload are not retained, only the route; the bytes of a "
          "failed one are, see the next check.")
    if sample:
        dev, mid, val, t, recv, pers = sample[0]
        entry = registry.get((dev, int(mid)))
        if entry:
            mp_id, src, fld, unit = entry
            rep.p("")
            rep.p("Worked example of one chain.")
            rep.p(f"    value        {val} {unit}")
            rep.p(f"    measured     {t.isoformat() if t else '-'}")
            rep.p(f"    received     {recv.isoformat() if recv else '-'}")
            rep.p(f"    persisted    {pers.isoformat() if pers else '-'}")
            rep.p(f"    device       {dev}, metric {mid}")
            rep.p(f"    metric point {mp_id}")
            rep.p(f"    arrived on   {topic_for(dev, src)}  field '{fld}'")

    # 4. error path ─────────────────────────────────────────────────────────
    with psycopg.connect(args.measurement_dsn) as m:
        err_total, err_first, err_last = m.execute(
            "SELECT count(*), min(created_at), max(created_at) FROM ingestion_errors "
            "WHERE created_at >= %s AND created_at < %s", (start, end)).fetchone()
        err_reasons = m.execute(
            "SELECT error_message, count(*) FROM ingestion_errors "
            "WHERE created_at >= %s AND created_at < %s "
            "GROUP BY 1 ORDER BY 2 DESC LIMIT 5", (start, end)).fetchall()
        err_sample = m.execute(
            "SELECT raw_payload, error_message FROM ingestion_errors "
            "WHERE created_at >= %s AND created_at < %s "
            "  AND raw_payload IS NOT NULL LIMIT 1", (start, end)).fetchone()

    rep.h("4 the error path, and what it does NOT cover")
    rep.p(f"rejected payloads in ingestion_errors : {err_total}")
    if err_total:
        rep.p(f"first .. last         : {err_first} .. {err_last}")
        for msg, cnt in err_reasons:
            rep.p(f"    {cnt:>6}  {msg}")
        if err_sample:
            payload = json.dumps(err_sample[0])
            rep.p(f"    raw payload kept    : {payload[:200]}")
        rep.p("A parse or write failure is a deliberate refusal and not silent loss. "
              "The raw payload is retained, so a rejected value can still be "
              "explained after the fact.")
    else:
        rep.p("None in this window, which means no payload failed to parse.")
    rep.p("")
    rep.p("The finding of this check is the boundary, not the count. Ingestion has "
          "two ways to discard a message and only one of them leaves a trace.")
    rep.p("  parse or write failure   -> ingestion_errors, raw payload retained")
    rep.p("  device not commissioned  -> dropped, INFO log line only, no row")
    rep.p("The second path returns success from the handler (mqtt.rs, the gate "
          "before parsing), so traffic from an unknown device leaves no persistent "
          "record. Verified by running the generator with --rogue, which published "
          "from uncommissioned devices and produced no rows here. For provenance "
          "that is defensible, since nothing was stored and nothing needs an "
          "origin. For operations it is a blind spot, because a misconfigured real "
          "device disappears without anything an operator can query later.")

    # 5. timestamp independence ─────────────────────────────────────────────
    with psycopg.connect(args.measurement_dsn) as m:
        families = m.execute(
            """
            SELECT CASE WHEN device_id LIKE '%%-boiler-%%' THEN 'boiler (device clock)'
                        ELSE 'sensor (receive-time fallback)' END AS family,
                   count(*),
                   count(*) FILTER (WHERE time <> received_at)
            FROM measurements
            WHERE device_id LIKE %s AND received_at >= %s AND received_at < %s
            GROUP BY 1 ORDER BY 2 DESC
            """, (like, start, end)).fetchall()

    rep.h("5 independence of the two timestamps, the honest caveat")
    independent_total = 0
    for family, cnt, indep in families:
        independent_total += indep
        share = 100.0 * indep / cnt if cnt else 0.0
        rep.p(f"  {family:<32} {cnt:>9} values, {indep:>9} with an independent "
              f"measurement time ({share:.1f} %)")
    overall = 100.0 * independent_total / total if total else 0.0
    rep.p(f"overall independent   : {overall:.1f} % of all values")
    rep.p("Where the payload carries no device clock, ingestion stamps the receive "
          "time into both fields. All four provenance fields are then present, but "
          "the measurement time adds nothing over the receive time. This is a "
          "property of the device protocol, not of the platform, and it is "
          "reported rather than averaged away.")

    # verdict ───────────────────────────────────────────────────────────────
    rep.h("verdict")
    checks = [
        ("four fields complete", total > 0 and pct == 100.0, f"{pct:.2f} %"),
        ("no orphaned channels", total > 0 and not orphans, f"{len(orphans)} orphans"),
        ("sample fully traceable", bool(sample) and traced == len(sample),
         f"{traced}/{len(sample)}"),
    ]
    for name, ok, actual in checks:
        rep.p(f"[{'ok' if ok else 'FAIL'}] {name:<28} {actual}")
    passed = all(ok for _, ok, _ in checks)
    rep.p("")
    rep.p("RESULT: " + ("all measurable response measures met" if passed
                        else "NOT met, see above"))
    rep.p("")
    rep.p("Not covered by this run. The calibration of a measuring device under "
          "RB-REG-04 cannot be shown with simulated hardware. It is carried in the "
          "data model and reported as constructively fulfilled and unmeasured.")

    path = out / f"qs-int-02-{stamp}.txt"
    path.write_text(rep.text(), encoding="utf-8")
    print(rep.text())
    print(f"report: {path}")
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
