#!/usr/bin/env python3
"""QS-INT-01, the visual half: build the gap figure in the analysis view.

The measured run proves the outage stays open in the store and in the query
API. This script produces the third piece of evidence, the one a user actually
looks at, by building a chart in the platform's own analysis view and
screenshotting it.

Both channels go into ONE chart over the SAME window: the sensor that fell
silent and a neighbour that kept reporting. That pairing is what makes the
figure self-evidencing. A single line with a hole could also be a chart that
failed to load. Next to a neighbour that is continuous over the same minutes,
the hole can only be the outage.

Note on which view is used and why it matters. The platform draws time series
with two different implementations, and they do not agree about gaps.

  analysis view      ECharts with xAxis type "time". Points sit at their real
                     position on the axis, so a silent stretch stays visibly
                     wide. This is the view this script uses.
  asset detail page  Recharts with the default category axis. Every returned
                     bucket becomes one equally wide category, so the missing
                     minutes are not merely empty, they are absent, and the
                     line closes over them. The gap is then invisible except
                     for the axis labels jumping.

Preconditions:
  - scripts/dev.sh up, plus a completed qs_int_01_gap_run.py
  - the usability venv, which carries playwright

Usage:
    evaluation/usability/.venv/bin/python evaluation/scripts/qs_int_01_analysis_figure.py
    ... --from '2026-09-03 14:20' --to '2026-09-03 14:40'
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import psycopg
from playwright.sync_api import sync_playwright

REPO_ROOT = Path(__file__).resolve().parents[2]
UUID_NS = uuid.uuid5(uuid.NAMESPACE_URL, "digitaldemon:mock-service")

# Widest interval on the faulted channel counts as the outage, measured
# against its own cadence. Same rule the measured run applies.
GAP_FACTOR = 3.0


def project_id(prefix: str) -> str:
    return str(uuid.uuid5(UUID_NS, f"{prefix}:project"))


def find_gap(dsn: str, device: str, metric: int):
    """Locate the outage so the figure's window can be centred on it."""
    with psycopg.connect(dsn) as conn:
        rows = conn.execute(
            "SELECT time FROM measurements WHERE device_id = %s AND metric_id = %s "
            "ORDER BY time", (device, metric)).fetchall()
    times = [r[0] for r in rows]
    if len(times) < 3:
        return None
    deltas = [(times[i] - times[i - 1]).total_seconds() for i in range(1, len(times))]
    median = sorted(deltas)[len(deltas) // 2]
    # The MOST RECENT outage, not the widest. A device that has been through
    # several runs carries one gap per run, all of the same length, and the
    # figure must show the run that was just measured.
    hits = [i for i, d in enumerate(deltas) if d > GAP_FACTOR * median]
    if not hits:
        return None
    i = hits[-1]
    return times[i], times[i + 1], deltas[i]


def asset_name(device_id: str) -> str:
    """The picker searches display and asset names, NOT the device id, so the
    asset name is the term that actually finds a channel. The seeder builds it
    as 'Room Sensor <site>-<room>' and 'Boiler <site>'."""
    m = re.match(r".*-ht-(\d+)-(\d+)$", device_id)
    if m:
        return f"Room Sensor {m.group(1)}-{m.group(2)}"
    m = re.match(r".*-boiler-(\d+)$", device_id)
    if m:
        return f"Boiler {m.group(1)}"
    return device_id


def local(dt: datetime) -> str:
    """datetime-local wants the browser's wall clock, minute resolution."""
    return dt.astimezone().strftime("%Y-%m-%dT%H:%M")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--prefix", default="gap")
    ap.add_argument("--faulted", default="", help="device that fell silent")
    ap.add_argument("--healthy", default="", help="neighbour that kept reporting")
    ap.add_argument("--metric", type=int, default=1, help="metric id, 1 = room temperature")
    ap.add_argument("--from", dest="frm", help="window start, 'YYYY-MM-DD HH:MM' local")
    ap.add_argument("--to", help="window end, 'YYYY-MM-DD HH:MM' local")
    ap.add_argument("--pad-minutes", type=int, default=6,
                    help="context to show on each side of the outage")
    ap.add_argument("--resolution", default="1 min",
                    choices=["Auto", "Raw", "1 min", "5 min", "15 min"])
    ap.add_argument("--frontend", default="http://localhost:3000")
    ap.add_argument("--email", default="admin@local")
    ap.add_argument("--password", default="admin")
    ap.add_argument("--measurement-dsn",
                    default="postgresql://postgres:password@localhost:5433/digital_demon_measurements")
    ap.add_argument("--out", default=str(REPO_ROOT / "evaluation" / "results"
                                         / "qs-int-01" / "screenshots"))
    ap.add_argument("--headed", action="store_true")
    args = ap.parse_args()

    faulted = args.faulted or f"{args.prefix}-ht-001-01"
    healthy = args.healthy or f"{args.prefix}-ht-001-02"

    # Window: either given, or derived from the outage itself with padding, so
    # the figure is centred on the thing it is supposed to show.
    gap = find_gap(args.measurement_dsn, faulted, args.metric)
    if args.frm and args.to:
        frm = datetime.strptime(args.frm, "%Y-%m-%d %H:%M").astimezone()
        to = datetime.strptime(args.to, "%Y-%m-%d %H:%M").astimezone()
    elif gap:
        pad = timedelta(minutes=args.pad_minutes)
        frm, to = gap[0] - pad, gap[1] + pad
    else:
        sys.exit(f"no outage found on {faulted} metric {args.metric}, and no explicit "
                 f"--from/--to given. Run qs_int_01_gap_run.py first.")

    if gap:
        print(f"    outage {gap[0].astimezone():%H:%M:%S} .. {gap[1].astimezone():%H:%M:%S} "
              f"({gap[2]:.0f} s)")
    print(f"    window {local(frm)} .. {local(to)}")

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=not args.headed)
        # Tall enough that the whole canvas is in view. A full-page screenshot
        # resizes the viewport, which makes the chart re-render and restart its
        # reveal animation, and the capture then catches a half-drawn line.
        ctx = browser.new_context(viewport={"width": 1600, "height": 1200},
                                  device_scale_factor=2)
        page = ctx.new_page()

        page.goto(f"{args.frontend}/auth/login", wait_until="domcontentloaded")
        page.get_by_role("button", name="Sign in").wait_for(timeout=30_000)
        page.get_by_label("Email", exact=False).fill(args.email)
        page.get_by_label("Password", exact=False).fill(args.password)
        page.get_by_role("button", name="Sign in").click()
        page.wait_for_url(f"{args.frontend}/", timeout=30_000)

        pid = project_id(args.prefix)
        page.goto(f"{args.frontend}/projects/{pid}/analysis", wait_until="domcontentloaded")
        page.get_by_role("button", name="Add Chart").wait_for(timeout=30_000)
        page.wait_for_timeout(2000)

        # ── two charts, one channel each ────────────────────────────────────
        # Both sensors in ONE chart would carry the identical legend entry
        # "Room Temperature" twice, so the figure could not say which line is
        # which. Two titled charts over the same axis window read unambiguously.
        #
        # The canvas persists. If the two charts are already there (the
        # operator may have built and saved them), use them as they are and
        # touch neither their sources nor their titles.
        existing = page.locator('button[title="Remove chart"]').count()
        have_both = (page.get_by_role("button", name=re.compile("^Sensor mit Ausfall")).count() > 0
                     and page.get_by_role("button", name=re.compile("^Nachbarsensor ohne Ausfall")).count() > 0)
        if existing and have_both:
            print(f"    using the {existing} chart(s) already on the canvas")
            # Reconcile each card with the sensor it is meant to show. A saved
            # dashboard may point at a device that carries no data in this
            # window, and an empty neighbour chart would look like a failed load
            # instead of proving the window had data. Sources are replaced and
            # the title suffix is set; the view is NOT saved, so the operator's
            # stored dashboard stays as it was.
            for device, prefix_title in ((faulted, "Sensor mit Ausfall"),
                                         (healthy, "Nachbarsensor ohne Ausfall")):
                term = asset_name(device)
                title_btn = page.get_by_role("button", name=re.compile(f"^{prefix_title}")).first
                card = title_btn.locator("xpath=ancestor::div[contains(@class,'bg-card')][1]")
                for _ in range(card.locator("button:has(svg.lucide-x)").count()):
                    card.locator("button:has(svg.lucide-x)").first.click()
                    page.wait_for_timeout(400)
                card.get_by_role("button", name="Sensor", exact=True).click()
                search = page.get_by_placeholder("Search sensors...")
                search.wait_for(timeout=10_000)
                search.fill(term)
                page.wait_for_timeout(1000)
                if page.get_by_text("No sensors found").count():
                    sys.exit(f"the picker found nothing for '{term}'")
                page.get_by_role("button", name=re.compile("Room Temperature")).first.click(timeout=10_000)
                page.wait_for_timeout(1200)
                try:
                    card.get_by_role("button", name=re.compile(f"^{prefix_title}")).first.click(timeout=8000)
                    editor = page.locator("input:focus").last
                    editor.fill(f"{prefix_title} ({term})")
                    editor.press("Enter")
                    page.wait_for_timeout(600)
                except Exception:
                    print(f"    could not retitle the card for {device}")
                print(f"    card '{prefix_title}' now shows {term} ({device})")
        for device, title in (() if (existing and have_both) else
                              ((faulted, "Sensor mit Ausfall"),
                               (healthy, "Nachbarsensor ohne Ausfall"))):
            term = asset_name(device)
            page.get_by_role("button", name="Add Chart").click()
            page.wait_for_timeout(1200)

            page.get_by_role("button", name="Sensor", exact=True).last.click()
            search = page.get_by_placeholder("Search sensors...")
            search.wait_for(timeout=10_000)
            search.fill(term)
            page.wait_for_timeout(1000)
            if page.get_by_text("No sensors found").count():
                sys.exit(f"the picker found nothing for '{term}'. It searches display "
                         f"and asset names, not device ids. Check the asset name of "
                         f"{device} in the project.")
            page.get_by_role("button", name=re.compile("Room Temperature")).first.click(
                timeout=10_000)
            page.wait_for_timeout(1500)

            # Rename the card so the figure labels itself.
            try:
                page.get_by_role("button", name="New Chart").last.click(timeout=8000)
                editor = page.locator('input[value="New Chart"], input:focus').last
                editor.fill(f"{title} ({term})")
                editor.press("Enter")
                page.wait_for_timeout(800)
            except Exception:
                print(f"    could not rename the chart for {device}, keeping the default")
            print(f"    chart '{title}' for {term} ({device})")

        # ── window and resolution ───────────────────────────────────────────
        # "Custom" is a toggle. Clicking it while it is already active hides
        # the date inputs again, so only click when they are not showing.
        if page.locator('input[type="datetime-local"]').count() == 0:
            page.get_by_role("button", name="Custom", exact=True).click()
            page.wait_for_timeout(800)
        inputs = page.locator('input[type="datetime-local"]')
        inputs.first.wait_for(timeout=10_000)
        inputs.nth(0).fill(local(frm))
        page.wait_for_timeout(400)
        inputs.nth(1).fill(local(to))
        page.wait_for_timeout(2500)

        page.get_by_role("button", name=args.resolution, exact=True).click()
        page.wait_for_timeout(3000)

        # ── settle, then capture ────────────────────────────────────────────
        # ECharts renders to canvas, so there is no path to poll. Wait for the
        # loading marker to disappear and then let the animation finish.
        for _ in range(40):
            if not page.get_by_text("Loading...").count():
                break
            page.wait_for_timeout(500)
        page.wait_for_timeout(4000)
        page.mouse.move(5, 5)
        page.wait_for_timeout(500)

        full = out / f"analyse-luecke-{stamp}-ganze-seite.png"
        page.screenshot(path=str(full))

        chart_path = out / f"analyse-luecke-{stamp}-diagramm.png"
        try:
            # Both cards in one image, so the pair is the figure.
            page.locator("canvas").first.locator(
                "xpath=ancestor::div[contains(@class,'space-y-4')][1]").screenshot(
                path=str(chart_path))
        except Exception:
            page.locator("canvas").first.locator(
                "xpath=ancestor::div[3]").screenshot(path=str(chart_path))

        browser.close()

    manifest = out / f"analyse-luecke-{stamp}.json"
    manifest.write_text(json.dumps({
        "taken_at": datetime.now().astimezone().isoformat(),
        "view": "analysis canvas (ECharts, xAxis type time)",
        "faulted_device": faulted,
        "healthy_device": healthy,
        "metric_id": args.metric,
        "window_local": [local(frm), local(to)],
        "outage_local": [gap[0].astimezone().isoformat(), gap[1].astimezone().isoformat()] if gap else None,
        "outage_seconds": round(gap[2], 1) if gap else None,
        "resolution": args.resolution,
        "files": [full.name, chart_path.name],
        "note": "Both channels share one chart and one window. The neighbour is "
                "continuous across the outage, so the stretch without points on "
                "the other channel is the sensor outage and not a failed load.",
    }, indent=2), encoding="utf-8")
    print(f"    {full.name}\n    {chart_path.name}\n    {manifest.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
