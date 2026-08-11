#!/usr/bin/env python3
"""QS-PER-01, second latency measure: system entry to availability for analysis.

Response measure: "p95 Eingang bis Bereitstellung für die Auswertung unter 1 s".
The database-side measure (persisted_at - received_at, see
sql/latency-percentiles.sql) stops at persistence. This script closes the
remaining leg by polling the analytics query API and recording when a
measurement first becomes visible there.

Method: poll POST /stats/latest at a fixed cadence. Each response carries the
measurement timestamp per channel. The first poll in which a given
(channel, timestamp) pair appears marks its visibility; the latency is the
poll's wall clock minus that timestamp.

Two channel families, two readings — reported separately because they mean
different things:

  Shelly channels  time == received_at (those payloads carry no device clock,
                   so ingestion stamps the receive time). The reading is
                   therefore literally "Eingang bis Bereitstellung", subject
                   only to the clock offset between this machine and the
                   ingestion pod (both NTP-synced, offset well under the
                   hundreds of ms this measures).

  Boiler channels  time == the generator's send clock. Since mock-service runs
                   on this same machine, no cross-machine offset applies, but
                   the reading additionally contains MQTT transport — it is
                   end-to-end and thus an upper bound.

Resolution is bounded by --interval: a value can only be observed at the next
poll, so every reading is an upper bound quantised to the poll cadence. Keep
the interval well below the 1 s target and state it in the protocol.

Usage:
    python3 visibility_poller.py --duration 300 \
        --core-host http://<core-lb>:8080 \
        --analytics-host http://<analytics-lb>:8100 \
        --csv ../results/qs-per-01-visibility.csv

Preconditions: platform up, fleet seeded, mock-service run active (otherwise
no new values appear and the script reports zero observations).
"""

from __future__ import annotations

import argparse
import csv
import os
import statistics
import sys
import time
from dataclasses import dataclass

import requests


@dataclass
class Observation:
    metric_point_id: str
    device_id: str
    family: str          # "boiler" (device clock) or "sensor" (receive time)
    measured_at: float   # epoch seconds, from the API response
    seen_at: float       # epoch seconds, this machine's wall clock
    latency_s: float
    # The very first poll returns whatever value each channel already had; its
    # age is arbitrary and says nothing about visibility latency. Marked here
    # and excluded from the statistics.
    priming: bool


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--core-host", default=os.environ.get("CORE_HOST", "http://localhost:8080"))
    p.add_argument("--analytics-host",
                   default=os.environ.get("ANALYTICS_HOST", "http://localhost:8100"))
    p.add_argument("--email", default=os.environ.get("LOGIN_EMAIL", "admin@local"))
    p.add_argument("--password", default=os.environ.get("LOGIN_PASSWORD", "admin"))
    p.add_argument("--project", default=os.environ.get("PROJECT_NAME", "Mock Fleet"))
    p.add_argument("--interval", type=float, default=0.5,
                   help="poll cadence in s; bounds the resolution (default 0.5)")
    p.add_argument("--duration", type=float, default=300.0, help="run length in s")
    p.add_argument("--channels", type=int, default=30,
                   help="how many metric points to watch (default 30)")
    p.add_argument("--csv", help="write raw observations here")
    return p.parse_args()


def login(core_host: str, email: str, password: str) -> str:
    resp = requests.post(f"{core_host}/api/v1/auth/login",
                         json={"email": email, "password": password}, timeout=10)
    resp.raise_for_status()
    return resp.json()["token"]


def harvest_channels(core_host: str, token: str, project_name: str, limit: int) -> list[dict]:
    """Metric points of the seeded fleet, boilers first so both families are watched."""
    headers = {"Authorization": f"Bearer {token}"}
    projects = requests.get(f"{core_host}/api/v1/projects",
                            headers=headers, timeout=10).json()["projects"]
    project = next((p for p in projects if p.get("name") == project_name), None)
    if project is None:
        sys.exit(f"Project '{project_name}' not found — seed the mock fleet first.")

    points = requests.get(f"{core_host}/api/v1/projects/{project['id']}/metric-points",
                          headers=headers, timeout=30).json()["metricPoints"]
    if not points:
        sys.exit(f"Project '{project_name}' has no metric points — seed and ingest first.")

    boilers = [p for p in points if "boiler" in (p.get("deviceId") or "")]
    sensors = [p for p in points if "boiler" not in (p.get("deviceId") or "")]
    # Interleave so a small --channels still covers both families.
    mixed: list[dict] = []
    for i in range(max(len(boilers), len(sensors))):
        if i < len(boilers):
            mixed.append(boilers[i])
        if i < len(sensors):
            mixed.append(sensors[i])
    return mixed[:limit]


def percentile(values: list[float], q: float) -> float:
    if not values:
        return float("nan")
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, max(0, int(len(ordered) * q) - 1))]


def report(label: str, observations: list[Observation]) -> None:
    if not observations:
        print(f"  {label:<34} no observations")
        return
    latencies = [o.latency_s for o in observations]
    print(f"  {label:<34} n={len(latencies):<6} "
          f"median={statistics.median(latencies) * 1000:7.0f} ms  "
          f"p95={percentile(latencies, 0.95) * 1000:7.0f} ms  "
          f"max={max(latencies) * 1000:7.0f} ms")


def main() -> int:
    args = parse_args()

    token = login(args.core_host, args.email, args.password)
    channels = harvest_channels(args.core_host, token, args.project, args.channels)
    by_id = {c["id"]: c for c in channels}
    ids = list(by_id)

    print(f"watching {len(ids)} channels "
          f"({sum(1 for c in channels if 'boiler' in (c.get('deviceId') or ''))} boiler, "
          f"{sum(1 for c in channels if 'boiler' not in (c.get('deviceId') or ''))} sensor) "
          f"for {args.duration:.0f}s at {args.interval}s cadence")

    session = requests.Session()
    session.headers["Authorization"] = f"Bearer {token}"

    seen: set[tuple[str, float]] = set()
    observations: list[Observation] = []
    deadline = time.time() + args.duration
    polls = 0
    errors = 0

    while time.time() < deadline:
        cycle_start = time.time()
        try:
            resp = session.post(f"{args.analytics_host}/stats/latest",
                                json={"metric_point_ids": ids}, timeout=10)
            now = time.time()
            resp.raise_for_status()
            polls += 1

            for value in resp.json().get("values", []):
                ts = value.get("time")
                mp_id = value.get("metricPointId")
                if ts is None or mp_id is None:
                    continue
                key = (mp_id, float(ts))
                if key in seen:
                    continue
                seen.add(key)
                device_id = value.get("deviceId") or ""
                observations.append(Observation(
                    metric_point_id=mp_id,
                    device_id=device_id,
                    family="boiler" if "boiler" in device_id else "sensor",
                    measured_at=float(ts),
                    seen_at=now,
                    latency_s=now - float(ts),
                    priming=(polls == 1),
                ))
        except requests.RequestException as e:
            errors += 1
            print(f"  poll failed: {e}", file=sys.stderr)

        sleep_for = args.interval - (time.time() - cycle_start)
        if sleep_for > 0:
            time.sleep(sleep_for)

    fresh = [o for o in observations if not o.priming]

    print(f"\npolls={polls} errors={errors} "
          f"observations={len(fresh)} (dropped {len(observations) - len(fresh)} "
          f"pre-existing values from the priming poll)\n")

    print("Visibility latency (upper bound, quantised to the poll cadence):")
    report("sensor = entry to availability", [o for o in fresh if o.family == "sensor"])
    report("boiler = end to end incl. transport", [o for o in fresh if o.family == "boiler"])
    report("all channels", fresh)

    if args.csv:
        with open(args.csv, "w", newline="") as fh:
            writer = csv.writer(fh)
            writer.writerow(["metric_point_id", "device_id", "family",
                             "measured_at", "seen_at", "latency_ms"])
            for o in fresh:
                writer.writerow([o.metric_point_id, o.device_id, o.family,
                                 f"{o.measured_at:.3f}", f"{o.seen_at:.3f}",
                                 f"{o.latency_s * 1000:.1f}"])
        print(f"\nraw observations written to {args.csv}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
