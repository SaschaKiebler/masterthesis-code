#!/usr/bin/env python3
"""QS-USA-01: commissioning walkthrough, counted and screenshotted.

Response measure: "Protokollierter Durchlauf von Montage bis zum ersten
sichtbaren Messwert, höchstens 10 Bedienschritte in der Bedienoberfläche."

Counting rule (belongs in ch. 6.2, because the limit of ten is not checkable
without it): a Bedienschritt is every point at which the technician chooses,
enters or triggers something. A "Next" that only confirms a selection already
made is not one, and the fields of a single form count together. Scrolling,
reading and hovering never count.

Note for anyone re-running this: the first version counted Playwright calls
rather than Bedienschritte, so every .fill() and .click() landed in the total
and the run reported 16 instead of 10. Screenshots are still taken for those
uncounted actions, they simply do not add to the count.

Every step is screenshotted, so the number can be re-derived from the artefacts
rather than believed.

Two totals are reported, because "from where" is a judgement the reader should
be able to check:

  from login      includes e-mail, password and submit
  from dashboard  starts at the logged-in home screen, which is what the
                  scenario's environment describes ("ein Mandantenkonto
                  besteht bereits")

What this run proves and what it does not: it proves the path exists and how
many actions it takes. It does not prove that a technician without deep IT
knowledge finds that path unaided — the operator here wrote the software. That
limitation belongs in ch. 6.6, with a third-party run as the outlook.

Usage:
    .venv/bin/python qs_usa_01_walkthrough.py --device-id usa-newsensor-001
"""

from __future__ import annotations

import argparse
import json
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

from playwright.sync_api import Page, sync_playwright


@dataclass
class Step:
    number: int
    label: str
    screenshot: str
    counted: bool
    note: str = ""      # why it does not count, when it does not


@dataclass
class Protocol:
    steps: list[Step] = field(default_factory=list)
    login_steps: int = 0
    # Three milestones. The wizard finishes at `created`; seeing the device's
    # configuration costs one more step, and seeing that data actually arrives
    # costs two beyond that.
    created_steps: int = 0
    commissioned_steps: int = 0
    started_at: float = 0.0
    first_value_at: float | None = None

    def total(self) -> int:
        return sum(1 for s in self.steps if s.counted)

    @property
    def from_dashboard(self) -> int:
        return self.total() - self.login_steps

    @property
    def from_login(self) -> int:
        return self.total()


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--base-url", default="http://localhost:3000")
    p.add_argument("--email", default="admin@local")
    p.add_argument("--password", default="admin")
    p.add_argument("--device-id", default="usa-newsensor-002",
                   help="device id the technician reads off the hardware label")
    p.add_argument("--sensor-name", default="Raumfuehler Wohnzimmer")
    p.add_argument("--location", default="Raum 001-01",
                   help="room the technician mounts the sensor in")
    p.add_argument("--sensor-type", default="Energy Meter",
                   help="sensor type as offered in wizard step 2")
    p.add_argument("--out", default="screenshots")
    p.add_argument("--template", default="Shelly Pro 3EM",
                   help="device template; it carries the signal map, i.e. the\n                        metric points the device will report")
    p.add_argument("--viewport", default="1440x900",
                   help="browser viewport WxH. Desktop is the default because its "
                        "screenshots are legible; the layout is responsive and a "
                        "narrow-viewport control run yields the same step count")
    p.add_argument("--headed", action="store_true", help="watch the run in a window")
    p.add_argument("--slow-mo", type=int, default=250, help="ms between actions")
    return p.parse_args()


class Walkthrough:
    def __init__(self, page: Page, out: Path, protocol: Protocol):
        self.page = page
        self.out = out
        self.protocol = protocol
        self._n = 0

    def shot(self, label: str, counted: bool = True,
             note: str = "") -> None:
        """Screenshot one point in the run and count it if it is a Bedienschritt.

        Pass counted=False with a note for everything that is only an
        intermediate action or a view, so the artefacts stay complete while the
        total stays honest.
        """
        self._n += 1
        name = f"{self._n:02d}-{label.lower().replace(' ', '-').replace(',', '')}.png"
        self.page.screenshot(path=str(self.out / name), full_page=False)
        self.protocol.steps.append(Step(self._n, label, name, counted, note))
        marker = "  " if counted else " ·"
        suffix = f"   ({note})" if note else ""
        print(f"{marker} {self._n:02d}  {label}{suffix}")


def publish_telemetry(device_id: str, attempts: int = 12) -> bool:
    """Feed one Shelly em:0 payload per attempt until a row is persisted.

    Stands in for the physical device coming online. Retried because
    device-management projects `device.configured` on a sweep of up to 30 s,
    and ingestion drops traffic from devices it does not know yet.
    """
    payload = json.dumps({"id": 0, "total_act_power": 1234.5, "total_current": 5.4})
    for i in range(attempts):
        subprocess.run([
            "docker", "compose", "-f", "docker/docker-compose-kafka.yaml",
            "exec", "-T", "mosquitto", "mosquitto_pub",
            "-t", f"{device_id}/status/em:0", "-m", payload,
        ], cwd=REPO_ROOT, capture_output=True, check=False)

        found = subprocess.run([
            "docker", "compose", "-f", "docker/docker-compose-kafka.yaml",
            "exec", "-T", "measurement-db", "psql", "-U", "postgres",
            "-d", "heating_platform_measurements", "-t", "-A", "-c",
            f"SELECT count(*) FROM measurements WHERE device_id = '{device_id}'",
        ], cwd=REPO_ROOT, capture_output=True, text=True, check=False)
        if found.stdout.strip().isdigit() and int(found.stdout.strip()) > 0:
            print(f"      Messwert persistiert nach {i * 5} s")
            return True
        time.sleep(5)
    print("      WARNUNG: kein Messwert persistiert")
    return False


def run(args: argparse.Namespace) -> Protocol:
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("*.png"):
        old.unlink()

    protocol = Protocol(started_at=time.time())

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=not args.headed, slow_mo=args.slow_mo)
        # Desktop is the default viewport because its screenshots are legible at
        # print size. The layout is responsive and the app is usable on a tablet,
        # which is what ch. 3 means by "the technician works on a mobile device".
        # A narrow-viewport control run reached the same milestone in the same
        # number of steps — the wizard becomes a bottom sheet, the path does not
        # change. Phone-sized viewports were not measured and are not claimed.
        vw, vh = (int(x) for x in args.viewport.lower().split("x"))
        context = browser.new_context(viewport={"width": vw, "height": vh},
                                      device_scale_factor=2)
        page = context.new_page()
        w = Walkthrough(page, out, protocol)

        # ── Login (counted separately) ────────────────────────────────────────
        # The dev server keeps an HMR socket open, so "networkidle" never
        # fires — wait for the elements that matter instead.
        page.goto(f"{args.base_url}/auth/login", wait_until="domcontentloaded")
        page.get_by_role("button", name="Sign in").wait_for(timeout=30000)
        w.shot("Anmeldemaske", counted=False)

        # Filling the two fields and submitting is one Bedienschritt, "anmelden".
        page.get_by_label("Email", exact=False).fill(args.email)
        w.shot("E-Mail eingegeben", counted=False, note="Feld des Anmeldeformulars")
        page.get_by_label("Password", exact=False).fill(args.password)
        w.shot("Passwort eingegeben", counted=False, note="Feld des Anmeldeformulars")
        page.get_by_role("button", name="Sign in").click()
        page.wait_for_url(f"{args.base_url}/", timeout=30000)
        page.wait_for_timeout(3000)
        w.shot("Anmeldung bestaetigt")
        protocol.login_steps = 1

        w.shot("Startseite nach Anmeldung", counted=False)

        # ── Commissioning ─────────────────────────────────────────────────────
        # One click from the home screen. The button sits on a project card and
        # deep-links into that project's wizard (?action=add-sensor), so this
        # single click picks the project and opens the wizard at once — there is
        # no separate project-selection step in the measured path.
        page.get_by_role("button", name="Add Sensor").first.click()
        page.wait_for_timeout(6000)
        # The wizard is a bottom sheet; scope every selector to it so the
        # topology tree behind it can never be hit by accident.
        sheet = page.locator('div[role="presentation"]').last
        sheet.get_by_text("Add Sensor").first.wait_for(timeout=20000)
        w.shot("Wizard geoeffnet")

        # Step 1: where the sensor sits. The picker is one flat, searchable list
        # of buildings, floors and rooms, so this is a single click, not a tree
        # walk. The "Next" that follows confirms a choice already made.
        sheet.get_by_role("button", name=args.location).click()
        w.shot("Ort gewaehlt")
        sheet.get_by_role("button", name="Next").click()
        page.wait_for_timeout(800)
        w.shot("Weiter zu Sensortyp", counted=False, note="bestaetigt nur die Auswahl")

        # Step 2: what kind of sensor
        sheet.get_by_role("button", name=args.sensor_type).first.click()
        w.shot("Sensortyp gewaehlt")
        sheet.get_by_role("button", name="Next").click()
        page.wait_for_timeout(800)
        w.shot("Weiter zu Vorlage", counted=False, note="bestaetigt nur die Auswahl")

        # Step 3: the template carries the signal map. Skipping it registers a
        # device that can never report a value — see the protocol note.
        sheet.get_by_role("button", name=args.template).first.click()
        w.shot("Vorlage gewaehlt")
        sheet.get_by_role("button", name="Next").click()
        page.wait_for_timeout(800)
        w.shot("Weiter zu Details", counted=False, note="bestaetigt nur die Auswahl")

        # Step 4: name and the id printed on the hardware. Two fields of one
        # form, so one Bedienschritt, "Details ausfüllen".
        sheet.get_by_label("Sensor Name", exact=False).fill(args.sensor_name)
        w.shot("Sensorname eingegeben", counted=False, note="Feld desselben Formulars")
        sheet.get_by_label("Device ID", exact=False).fill(args.device_id)
        w.shot("Geraete-ID eingegeben")
        sheet.get_by_role("button", name="Create Sensor").click()
        page.wait_for_timeout(6000)
        w.shot("Sensor angelegt")
        protocol.created_steps = protocol.total()

        w.shot("Sensor in der Topologie", counted=False)

        # ── Montage: the device starts sending ────────────────────────────────
        # Not a Bedienschritt — this is the hardware being powered up, which the
        # scenario calls "Montage". device-management needs one projection sweep
        # (<= 30 s) before ingestion accepts the new device.
        print("\n   … warte auf device.configured und speise Telemetrie ein")
        publish_telemetry(args.device_id)
        protocol.first_value_at = time.time()

        # ── First visible measurement ─────────────────────────────────────────
        page.reload(wait_until="domcontentloaded")
        page.wait_for_timeout(4000)
        sensor = page.get_by_text(args.sensor_name).first
        sensor.click()
        page.wait_for_timeout(3000)
        # The object panel proves the device is commissioned and configured; it
        # does NOT show a value. Counted as its own milestone.
        w.shot("Geraet in Betrieb, Konfiguration sichtbar")
        protocol.commissioned_steps = protocol.total()

        # The commissioning path ends WITHOUT a measured value on screen. Reaching
        # a view that confirms data is arriving costs two more clicks, because the
        # IDE's back button returns to the dashboard rather than to the project.
        page.get_by_role("button", name="Back").first.click()
        page.wait_for_timeout(4000)
        w.shot("Zurueck zur Startseite")
        page.get_by_text("Mock Fleet").first.click()
        page.wait_for_timeout(6000)
        w.shot("Messbetrieb sichtbar in der Projektuebersicht")

        context.close()
        browser.close()

    return protocol


def main() -> int:
    args = parse_args()
    print("QS-USA-01 — protokollierter Inbetriebnahme-Durchlauf\n")
    protocol = run(args)

    out = Path(args.out)
    duration = (protocol.first_value_at or time.time()) - protocol.started_at

    created = protocol.created_steps
    commissioned = protocol.commissioned_steps
    print("\n─ Ergebnis, Bedienschritte ──────────────────────────────")
    print(f"  bis Geraet angelegt        ab Anmeldung {created:>3}"
          f"   ab Startseite {created - protocol.login_steps:>3}")
    print(f"  bis Konfiguration sichtbar ab Anmeldung {commissioned:>3}"
          f"   ab Startseite {commissioned - protocol.login_steps:>3}")
    print(f"  bis Messbetrieb sichtbar   ab Anmeldung {protocol.from_login:>3}"
          f"   ab Startseite {protocol.from_dashboard:>3}")
    print(f"  Grenzwert laut QS-USA-01                 10")
    verdict = "erfuellt" if protocol.from_login <= 10 else "VERFEHLT"
    print(f"  Bewertung (Messbetrieb, ab Anmeldung)    {verdict}")
    print(f"  Dauer des Durchlaufs             {duration:.0f} s")
    print(f"  Screenshots                      {len(protocol.steps)} in {out}/")

    (out / "protokoll.json").write_text(json.dumps({
        "limit": 10,
        "steps_until_created_from_login": created,
        "steps_until_created_from_dashboard": created - protocol.login_steps,
        "steps_until_commissioned_from_login": commissioned,
        "steps_until_commissioned_from_dashboard": commissioned - protocol.login_steps,
        "steps_until_visible_from_login": protocol.from_login,
        "steps_until_visible_from_dashboard": protocol.from_dashboard,
        "duration_seconds": round(duration, 1),
        "steps": [
            {"nr": s.number, "label": s.label, "screenshot": s.screenshot,
             "counted": s.counted, "note": s.note}
            for s in protocol.steps
        ],
    }, indent=2, ensure_ascii=False))
    print(f"  Protokoll                        {out}/protokoll.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
