#!/usr/bin/env python3
"""QS-INT-01, the visual half: the gap must stay a gap in the user interface.

The measured run (qs_int_01_gap_run.py) proves the outage is open in the store
and in the query API. This script adds the third surface a user actually looks
at. It drives the web interface with a browser and screenshots the measurement
chart of the faulted sensor next to a healthy neighbour over the same window.

Why the pair matters: a single chart with a hole could also be a chart that
failed to load. Side by side, the healthy neighbour shows the window did carry
data, so the hole in the other one is the sensor outage and nothing else. That
is the same reasoning the neighbour check applies in the measured run, moved to
the visual evidence.

Preconditions:
  - scripts/dev.sh up, and a completed qs_int_01_gap_run.py whose outage still
    falls inside the chart preset used here (the 1h preset covers roughly the
    last hour, so take the screenshots soon after the run)
  - the usability venv, which carries playwright:
      evaluation/usability/.venv/bin/python -m playwright install chromium

Usage:
    evaluation/usability/.venv/bin/python evaluation/scripts/qs_int_01_screenshots.py
    ... --prefix gap --preset 1h
"""

from __future__ import annotations

import argparse
import json
import sys
import uuid
from datetime import datetime
from pathlib import Path

from playwright.sync_api import sync_playwright

REPO_ROOT = Path(__file__).resolve().parents[2]
UUID_NS = uuid.uuid5(uuid.NAMESPACE_URL, "heating-platform:mock-service")


def asset_id(prefix: str, device_id: str) -> str:
    return str(uuid.uuid5(UUID_NS, f"{prefix}:asset:{device_id}"))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--prefix", default="gap")
    ap.add_argument("--faulted", default="", help="device that lost its signal")
    ap.add_argument("--healthy", default="", help="neighbour that kept reporting")
    ap.add_argument("--preset", default="1h", choices=["1h", "3h", "6h", "24h", "7d", "30d"],
                    help="chart window; must still contain the outage")
    ap.add_argument("--frontend", default="http://localhost:3000")
    ap.add_argument("--email", default="admin@local")
    ap.add_argument("--password", default="admin")
    ap.add_argument("--out", default=str(REPO_ROOT / "evaluation" / "results"
                                         / "qs-int-01" / "screenshots"))
    ap.add_argument("--headed", action="store_true")
    args = ap.parse_args()

    faulted = args.faulted or f"{args.prefix}-ht-001-01"
    healthy = args.healthy or f"{args.prefix}-ht-001-02"
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    shots: list[dict] = []

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=not args.headed)
        context = browser.new_context(viewport={"width": 1440, "height": 1600})
        page = context.new_page()

        # ── login ───────────────────────────────────────────────────────────
        # `networkidle` is unusable against the dev server: its hot-reload
        # socket never closes, so the wait always runs into the timeout. Wait
        # for the elements instead, as the usability walkthrough does.
        page.goto(f"{args.frontend}/auth/login", wait_until="domcontentloaded")
        page.get_by_role("button", name="Sign in").wait_for(timeout=30_000)
        page.get_by_label("Email", exact=False).fill(args.email)
        page.get_by_label("Password", exact=False).fill(args.password)
        page.get_by_role("button", name="Sign in").click()
        page.wait_for_url(f"{args.frontend}/", timeout=30_000)
        page.wait_for_timeout(2000)

        for label, device in (("ausfall", faulted), ("gesund", healthy)):
            aid = asset_id(args.prefix, device)
            # A fresh page per asset, sharing the logged-in context. Reusing one
            # page left the second chart rendering a stub of the first one's
            # data, reproducibly, which looked like a sensor with no values.
            page = context.new_page()
            page.set_viewport_size({"width": 1440, "height": 1600})
            page.goto(f"{args.frontend}/assets/{aid}", wait_until="domcontentloaded")

            def is_measurements(resp):
                return "/measurements" in resp.url and resp.status == 200

            # Pick the window that still contains the outage, and tie the wait
            # to the refetch it triggers. Waiting on a timer instead captured a
            # chart that still held the stub of a previous, smaller fetch, which
            # looked like a sensor with almost no data at all.
            try:
                with page.expect_response(is_measurements, timeout=30_000):
                    page.get_by_role("button", name=args.preset,
                                     exact=True).click(timeout=15_000)
            except Exception as e:
                print(f"    range button {args.preset} on {device}: {type(e).__name__}, "
                      f"waiting for any measurement response instead")
                try:
                    page.wait_for_response(is_measurements, timeout=30_000)
                except Exception:
                    pass
            # Wait for the chart to actually carry a drawn line instead of
            # sleeping blindly. A fixed sleep captured a half-fetched chart on
            # the first attempt and produced two screenshots that contradicted
            # each other.
            try:
                page.wait_for_function(
                    """() => {
                        const p = document.querySelectorAll('.recharts-line-curve');
                        if (!p.length) return false;
                        return [...p].some(e => (e.getAttribute('d') || '').length > 200);
                    }""", timeout=30_000)
            except Exception:
                print(f"    no drawn line on {device} within 30 s, capturing anyway")
            # Bring the chart into view BEFORE waiting. Screenshotting an element
            # scrolls it into view on its own, and recharts restarts its reveal
            # animation when the chart enters the viewport. Scrolling first and
            # waiting afterwards is what separates a drawn line from a stub, and
            # it is why the neighbour chart came out empty four times in a row
            # while its SVG path was fully present in the DOM.
            try:
                page.locator(".recharts-wrapper").first.scroll_into_view_if_needed(timeout=10_000)
                page.wait_for_timeout(1000)
            except Exception:
                pass

            # recharts draws the line with a running stroke-dashoffset, so a
            # screenshot taken too early catches a half-drawn curve that looks
            # like missing data. Wait for the offset to reach zero instead of
            # guessing, with a generous fallback sleep.
            try:
                page.wait_for_function(
                    """() => [...document.querySelectorAll('.recharts-line-curve')]
                              .every(e => {
                                  const o = getComputedStyle(e).strokeDashoffset;
                                  return !o || o === 'none' || parseFloat(o) === 0;
                              })""", timeout=20_000)
            except Exception:
                pass
            # Poll until the longest drawn path stops changing. The line is
            # both animated and refetched, so "long enough" is only knowable by
            # observing that it has settled.
            previous, stable = "", 0
            for _ in range(40):
                current = page.evaluate(
                    """() => {
                        const els = [...document.querySelectorAll('.recharts-line-curve')];
                        const d = els.map(e => e.getAttribute('d') || '')
                                     .sort((a, b) => b.length - a.length)[0] || '';
                        // The reveal animation runs on stroke-dasharray. Fold it
                        // into the key so a mid-animation state never counts as
                        // settled.
                        const dash = els.map(e => getComputedStyle(e).strokeDasharray || '')
                                        .join('|');
                        return d + '##' + dash;
                    }""")
                stable = stable + 1 if current == previous and len(current) > 300 else 0
                if stable >= 2:
                    break
                previous = current
                page.wait_for_timeout(500)
            else:
                print(f"    chart on {device} never settled, capturing as is")

            # Park the pointer outside the plot, otherwise recharts leaves a
            # tooltip open that covers part of the very series being shown.
            page.mouse.move(5, 5)
            page.wait_for_timeout(500)

            full = out / f"{label}-{device}-{args.preset}-ganze-seite.png"
            page.screenshot(path=str(full))

            # The chart alone, which is what goes into the thesis figure.
            chart_path = out / f"{label}-{device}-{args.preset}-diagramm.png"
            chart = None
            for sel in ("svg.recharts-surface", ".recharts-wrapper", "canvas"):
                loc = page.locator(sel).first
                if loc.count() and loc.is_visible():
                    chart = loc
                    break
            if chart is not None:
                # One level up usually carries the card with its heading.
                try:
                    chart.locator("xpath=ancestor::*[self::div][3]").screenshot(
                        path=str(chart_path))
                except Exception:
                    chart.screenshot(path=str(chart_path))
            else:
                print(f"    no chart element found on {device}, full page only")
                chart_path = None

            page.close()
            shots.append({"role": label, "device": device, "asset_id": aid,
                          "preset": args.preset, "full_page": full.name,
                          "chart": chart_path.name if chart_path else None})
            print(f"    {label:<8} {device:<20} -> {full.name}")

        browser.close()

    manifest = out / "manifest.json"
    manifest.write_text(json.dumps(
        {"taken_at": datetime.now().astimezone().isoformat(),
         "frontend": args.frontend, "preset": args.preset,
         "note": "The faulted and the healthy channel over the SAME window. The "
                 "healthy one proves the window carried data, so the hole in the "
                 "other is the outage and not a failed load.",
         "screenshots": shots}, indent=2), encoding="utf-8")
    print(f"manifest: {manifest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
