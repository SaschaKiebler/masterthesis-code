#!/usr/bin/env python3
"""QS-MOD-01 and QS-MOD-02: two configuration walkthroughs, screenshotted.

Both scenarios claim that a change which sounds like development work is a
configuration act in this platform. The walkthrough shows exactly that, step
by step in the web interface, with one screenshot per step. Nothing in the
code repository is touched and no service is redeployed. The protocol records
both facts so the reader does not have to take them on trust.

QS-MOD-01, a device type the platform has never seen:
  1. A device of a new type starts publishing. The platform knows neither the
     device nor its payload layout, so ingestion drops the traffic and the
     broker watcher lists the device as discovered.
  2. Device Scanner: listen for the device, capture its messages, analyze the
     payload. The analysis proposes a signal map, i.e. which JSON field is
     which metric.
  3. Create Template: the proposal becomes a device template in the catalogue.
  4. Add Sensor wizard: a sensor of the new type is placed in the topology and
     bound to the device id. The template supplies the signal map.
  5. Within one projection sweep (up to 30 s) ingestion accepts the device
     and its values appear in the store. The protocol notes the delay.

QS-MOD-02, a rule that changes:
  1. Open the boiler in the project IDE, its anomaly rules are listed.
  2. Add a rule from a detector template with a parameter of one's own, here
     the warm-weather threshold of "Heating despite warm weather".
  3. Change an existing rule (disable and re-enable) and open a custom
     condition rule in the condition builder.
  4. The rule reaches the analytics service through the compacted
     `anomaly-rule.configured` topic right after the commit. The protocol
     reads that topic and records the rule id it found.

What this does not show: variant 2 of both scenarios (a new transport
protocol, a new detector template) is a code change by definition and is
argued structurally in the thesis, not run here.

Preconditions:
  - scripts/dev.sh up, with a seeded fleet so the IDE has a boiler with rules
    (the qs_int_01_gap_run.py seed "gap" is what the defaults expect)
  - the usability venv, which carries playwright and psycopg:
      evaluation/usability/.venv/bin/python -m playwright install chromium

Usage:
    evaluation/usability/.venv/bin/python evaluation/scripts/qs_mod_walkthrough.py
    ... --only mod-01        # or mod-02
    ... --headed --slow-mo 400
"""

from __future__ import annotations

import argparse
import json
import random
import re
import subprocess
import sys
import threading
import time
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path

import psycopg
from playwright.sync_api import Page, sync_playwright

REPO_ROOT = Path(__file__).resolve().parents[2]
RESULTS = REPO_ROOT / "evaluation" / "results"
COMPOSE = ["docker", "compose", "-f", "docker/docker-compose-kafka.yaml"]
UUID_NS = uuid.uuid5(uuid.NAMESPACE_URL, "digitaldemon:mock-service")


# ── protocol ─────────────────────────────────────────────────────────────────

@dataclass
class Step:
    nr: int
    label: str
    screenshot: str
    counted: bool
    note: str = ""


@dataclass
class Protocol:
    scenario: str
    started_at: str
    steps: list[Step] = field(default_factory=list)
    facts: dict = field(default_factory=dict)

    def total(self) -> int:
        return sum(1 for s in self.steps if s.counted)


class Walkthrough:
    """Screenshot helper, same counting rule as the QS-USA-01 walkthrough.

    A counted step is a point where the user chooses, enters or triggers
    something. Views, waits and confirmations of a choice already made are
    screenshotted but not counted.
    """

    def __init__(self, page: Page, out: Path, protocol: Protocol):
        self.page = page
        self.out = out
        self.protocol = protocol
        self._n = 0

    def shot(self, label: str, counted: bool = True, note: str = "",
             full_page: bool = False) -> None:
        self._n += 1
        slug = re.sub(r"[^a-z0-9]+", "-", label.lower()
                      .replace("ä", "ae").replace("ö", "oe").replace("ü", "ue")
                      .replace("ß", "ss")).strip("-")
        name = f"{self._n:02d}-{slug}.png"
        self.page.screenshot(path=str(self.out / name), full_page=full_page)
        self.protocol.steps.append(Step(self._n, label, name, counted, note))
        marker = "  " if counted else " ·"
        suffix = f"   ({note})" if note else ""
        print(f"{marker} {self._n:02d}  {label}{suffix}")


# ── environment snapshot ─────────────────────────────────────────────────────

def snapshot() -> dict:
    """What the response measure is about: the code and the running services.

    `git status` empty and the same commit before and after means 0 changed
    lines. The same container ids with the same start times means nothing
    was redeployed or restarted.
    """
    head = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=REPO_ROOT,
                          capture_output=True, text=True).stdout.strip()
    dirty = subprocess.run(["git", "status", "--porcelain", "--", "applications", "apis"],
                           cwd=REPO_ROOT, capture_output=True, text=True).stdout.strip()
    ps = subprocess.run(["docker", "ps", "--format", "{{.ID}} {{.Names}} {{.CreatedAt}}"],
                        capture_output=True, text=True).stdout.strip().splitlines()
    return {"commit": head,
            "uncommitted_changes_in_services": dirty.splitlines(),
            "containers": sorted(ps)}


# ── the new device ────────────────────────────────────────────────────────────

class HeatMeter(threading.Thread):
    """A heat meter of a type the platform has never seen.

    Publishes to `<device_id>/data`, the generic topic layout, with field names
    that exist in no template. Runs until stopped, because the point of the
    scenario is that the device keeps talking while it is being configured.
    """

    def __init__(self, device_id: str, interval_s: float = 5.0):
        super().__init__(daemon=True)
        self.device_id = device_id
        self.interval_s = interval_s
        self.published = 0
        self._stop = threading.Event()
        self._energy = 48213.7
        self._volume = 1830.4

    def payload(self) -> str:
        flow = round(61.5 + random.uniform(-0.8, 0.8), 1)
        ret = round(47.0 + random.uniform(-0.6, 0.6), 1)
        power = round(13.5 + random.uniform(-1.0, 1.0), 2)
        self._energy = round(self._energy + power * self.interval_s / 3600, 3)
        self._volume = round(self._volume + 0.004, 3)
        return json.dumps({"flow_c": flow, "return_c": ret, "power_kw": power,
                           "energy_kwh": self._energy, "volume_m3": self._volume,
                           "ts": int(time.time())})

    def run(self) -> None:
        while not self._stop.is_set():
            subprocess.run(COMPOSE + ["exec", "-T", "mosquitto", "mosquitto_pub",
                                      "-t", f"{self.device_id}/data", "-m", self.payload()],
                           cwd=REPO_ROOT, capture_output=True, check=False)
            self.published += 1
            self._stop.wait(self.interval_s)

    def stop(self) -> None:
        self._stop.set()


# ── database checks ───────────────────────────────────────────────────────────

def measurement_count(ts_dsn: str, device_id: str) -> int:
    with psycopg.connect(ts_dsn) as conn:
        return conn.execute("SELECT count(*) FROM measurements WHERE device_id = %s",
                            (device_id,)).fetchone()[0]


def wait_for_first_value(ts_dsn: str, device_id: str, timeout_s: float = 120) -> float | None:
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        if measurement_count(ts_dsn, device_id) > 0:
            return round(time.time() - t0, 1)
        time.sleep(2)
    return None


def discovered(core_dsn: str, device_id: str) -> dict | None:
    with psycopg.connect(core_dsn) as conn:
        row = conn.execute("SELECT protocol, sample_topic, first_seen_at FROM discovered_devices "
                           "WHERE device_id = %s", (device_id,)).fetchone()
    return None if row is None else {"protocol": row[0], "sample_topic": row[1],
                                     "first_seen_at": row[2].isoformat()}


def reset(core_dsn: str, ts_dsn: str, args: argparse.Namespace) -> dict:
    """Remove what a previous run of QS-MOD-01 left behind.

    The template name is unique and the device id is bound once, so a repeat
    run would fail at the modal. Only rows this walkthrough creates are
    touched, nothing of the seeded fleet.
    """
    removed: dict[str, int] = {}
    with psycopg.connect(core_dsn) as conn:
        ids = [r[0] for r in conn.execute(
            "SELECT id FROM metric_points WHERE device_id = %s", (args.device_id,)).fetchall()]
        if ids:
            removed["metric_points"] = conn.execute(
                "DELETE FROM metric_points WHERE id = ANY(%s)", (ids,)).rowcount
            # links, project_objects and the typed extension rows cascade
            conn.execute("DELETE FROM objects WHERE id = ANY(%s)", (ids,))
        removed["physical_devices"] = conn.execute(
            "DELETE FROM physical_devices WHERE device_id = %s", (args.device_id,)).rowcount
        sensors = [r[0] for r in conn.execute(
            "SELECT id FROM objects WHERE display_name = %s", (args.sensor_name,)).fetchall()]
        if sensors:
            removed["sensor_objects"] = conn.execute(
                "DELETE FROM objects WHERE id = ANY(%s)", (sensors,)).rowcount
        removed["device_templates"] = conn.execute(
            "DELETE FROM device_templates WHERE name = %s", (args.template_name,)).rowcount
        conn.commit()
    with psycopg.connect(ts_dsn) as conn:
        removed["measurements"] = conn.execute(
            "DELETE FROM measurements WHERE device_id = %s", (args.device_id,)).rowcount
        conn.commit()
    return {k: v for k, v in removed.items() if v}


def object_id_by_name(core_dsn: str, name: str) -> str | None:
    with psycopg.connect(core_dsn) as conn:
        row = conn.execute("SELECT id FROM objects WHERE display_name = %s "
                           "ORDER BY created_at DESC LIMIT 1", (name,)).fetchone()
    return None if row is None else str(row[0])


def metric_points(core_dsn: str, device_id: str) -> list[dict]:
    with psycopg.connect(core_dsn) as conn:
        rows = conn.execute("SELECT metric_id, source, field, unit FROM metric_points "
                            "WHERE device_id = %s ORDER BY metric_id", (device_id,)).fetchall()
    return [{"metric_id": r[0], "source": r[1], "field": r[2], "unit": r[3]} for r in rows]


def switch_channel(core_dsn: str, device_id: str) -> tuple[str, str] | None:
    """The boiler's own burner or pump channel, as (metric point id, name).

    Chosen by id and not by label, because every seeded tenant has a
    "Boiler 001" and the channel list shows them all with the same text.
    """
    with psycopg.connect(core_dsn) as conn:
        rows = conn.execute(
            "SELECT mp.id, o.display_name FROM metric_points mp JOIN objects o ON o.id = mp.id "
            "WHERE mp.device_id = %s ORDER BY mp.metric_id", (device_id,)).fetchall()
    for pat in ("burner", "pump", "running", "on"):
        for mp_id, name in rows:
            if re.search(pat, name or "", re.I):
                return str(mp_id), name
    return (str(rows[0][0]), rows[0][1]) if rows else None


def anomaly_rule(core_dsn: str, name: str) -> dict | None:
    with psycopg.connect(core_dsn) as conn:
        row = conn.execute("SELECT id, detector, params, bindings, enabled FROM anomaly_rules "
                           "WHERE name = %s ORDER BY created_at DESC LIMIT 1", (name,)).fetchone()
    return None if row is None else {"id": str(row[0]), "detector": row[1], "params": row[2],
                                     "bindings": row[3], "enabled": row[4]}


def rule_on_topic(rule_id: str, topic: str = "anomaly-rule.configured",
                  timeout_ms: int = 8000) -> bool:
    """Read the compacted topic and look for the rule id as a message key.

    This is the hand-over point to the analytics service. The core publishes
    right after the commit, so the id should be there within seconds.
    """
    res = subprocess.run(COMPOSE + ["exec", "-T", "kafka", "/opt/kafka/bin/kafka-console-consumer.sh",
                                    "--bootstrap-server", "localhost:9092", "--topic", topic,
                                    "--from-beginning", "--property", "print.key=true",
                                    "--property", "print.value=false",
                                    "--timeout-ms", str(timeout_ms)],
                         cwd=REPO_ROOT, capture_output=True, text=True, check=False)
    return rule_id in res.stdout


# ── browser helpers ───────────────────────────────────────────────────────────

def login(page: Page, base: str, email: str, password: str) -> None:
    page.goto(f"{base}/auth/login", wait_until="domcontentloaded")
    page.get_by_role("button", name="Sign in").wait_for(timeout=30_000)
    page.get_by_label("Email", exact=False).fill(email)
    page.get_by_label("Password", exact=False).fill(password)
    page.get_by_role("button", name="Sign in").click()
    page.wait_for_url(f"{base}/", timeout=30_000)
    page.wait_for_timeout(1500)


# ── QS-MOD-01 ─────────────────────────────────────────────────────────────────

def run_mod_01(page: Page, args: argparse.Namespace) -> Protocol:
    out = RESULTS / "qs-mod-01" / "screenshots"
    out.mkdir(parents=True, exist_ok=True)
    proto = Protocol("QS-MOD-01", datetime.now().astimezone().isoformat())
    w = Walkthrough(page, out, proto)
    base = args.base_url
    for old in out.glob("*.png"):
        old.unlink()
    left = reset(args.core_dsn, args.ts_dsn, args)
    if left:
        print(f"    removed leftovers of a previous run: {left}")
    # A sweep may still carry the old accepted state for up to 30 s. Wait it
    # out so the "dropped before configuration" fact is genuine.
    time.sleep(35 if left else 0)
    proto.facts["before"] = snapshot()

    meter = HeatMeter(args.device_id, args.publish_interval)
    meter.start()
    # Let the platform meet the device before anyone configures it. The
    # watcher throttles per device, so a few seconds are enough for the
    # discovered_devices row and for ingestion to have dropped some traffic.
    time.sleep(max(2 * args.publish_interval, 8))
    proto.facts["device"] = {
        "device_id": args.device_id,
        "topic": f"{args.device_id}/data",
        "payload_example": meter.payload(),
        "discovered_before_configuration": discovered(args.core_dsn, args.device_id),
        "measurements_before_configuration": measurement_count(args.ts_dsn, args.device_id),
    }

    # Device Scanner
    page.goto(f"{base}/discovery", wait_until="domcontentloaded")
    page.get_by_label("Device ID").wait_for(timeout=30_000)
    w.shot("Device Scanner geoeffnet", counted=False)
    page.get_by_label("Device ID").fill(args.device_id)
    w.shot("Geraete-ID eingegeben")
    page.get_by_role("button", name="Start Listening").click()
    # Three messages on the one topic is the session's own cap per topic, so
    # waiting for "3 messages" means the feed is as full as it gets.
    try:
        page.get_by_text(re.compile(r"\b[3-9]\d* messages? captured")).wait_for(timeout=60_000)
    except Exception:
        page.wait_for_timeout(3 * args.publish_interval * 1000)
    w.shot("Nachrichten des Geraets empfangen")
    page.get_by_role("button", name="Stop").click()
    page.get_by_role("button", name="Analyze Payloads").wait_for(timeout=15_000)
    w.shot("Empfang beendet")
    page.get_by_role("button", name="Analyze Payloads").click()
    page.get_by_text("Suggested Signal Map").wait_for(timeout=30_000)
    w.shot("Payload analysiert, Signal-Map vorgeschlagen", full_page=True)

    # Template from the analysis
    page.get_by_role("button", name="Create Template").click()
    page.get_by_label("Template Name").wait_for(timeout=15_000)
    w.shot("Vorlage aus der Analyse vorbelegt", counted=False,
           note="Signal-Map und Protokoll sind uebernommen")
    page.get_by_label("Template Name").fill(args.template_name)
    page.get_by_label("Manufacturer").fill(args.manufacturer)
    page.get_by_label("Model Number").fill(args.model)
    ot = page.get_by_label("Object Type")
    label = next((o for o in ot.locator("option").all_text_contents()
                  if o.startswith(args.sensor_type)), None)
    if label:
        ot.select_option(label=label)
    else:
        print(f"    object type '{args.sensor_type}' not offered, leaving None")
    w.shot("Vorlage benannt und Objekttyp gewaehlt")
    # The proposal lists every JSON field, including the device's own
    # timestamp, and knows no units. Drop the timestamp and pick units, which
    # is what anyone would do before saving a template. Every row's inputs
    # share the same generated ids, so the work is scoped per row card.
    units = {"flow_c": "celsius", "return_c": "celsius", "power_kw": "kW",
             "energy_kwh": "kWh", "volume_m3": "m3"}

    def rows():
        return page.get_by_text(re.compile(r"^Channel \d+$")).locator("xpath=../..")

    for i in range(rows().count()):
        row = rows().nth(i)
        if row.locator("#input-field").input_value() == "ts":
            row.get_by_label(re.compile(r"^Remove channel")).click()
            break
    for i in range(rows().count()):
        row = rows().nth(i)
        unit = units.get(row.locator("#input-field").input_value())
        if unit:
            row.locator("select").first.select_option(value=unit)
    page.get_by_text("Default Signal Map").scroll_into_view_if_needed()
    page.wait_for_timeout(400)
    w.shot("Signal-Map nachbearbeitet, Zeitstempel entfernt, Einheiten gesetzt", full_page=True)
    page.get_by_role("button", name="Create Template").last.click()
    page.get_by_label("Template Name").wait_for(state="hidden", timeout=20_000)
    page.wait_for_timeout(800)
    w.shot("Vorlage angelegt", counted=False)

    page.goto(f"{base}/templates", wait_until="domcontentloaded")
    page.get_by_text(args.template_name).first.wait_for(timeout=30_000)
    w.shot("Neue Vorlage im Geraetekatalog", counted=False)

    # Add Sensor wizard, opened from the project IDE so the project is known.
    # Same wizard and same steps as in the QS-USA-01 walkthrough.
    page.goto(f"{base}/projects/{args.project_id}/ide", wait_until="domcontentloaded")
    page.get_by_role("button", name="Add Sensor").first.wait_for(timeout=40_000)
    page.get_by_role("button", name="Add Sensor").first.click()
    sheet = page.locator('div[role="presentation"]').last
    sheet.get_by_text("Add Sensor").first.wait_for(timeout=20_000)
    w.shot("Sensor-Wizard geoeffnet")
    sheet.get_by_role("button", name=args.location).first.click()
    w.shot("Ort gewaehlt")
    sheet.get_by_role("button", name="Next").click()
    page.wait_for_timeout(600)
    sheet.get_by_role("button", name=args.sensor_type).first.click()
    w.shot("Sensortyp gewaehlt")
    sheet.get_by_role("button", name="Next").click()
    page.wait_for_timeout(600)
    sheet.get_by_role("button", name=args.template_name).first.click()
    w.shot("Neue Vorlage gewaehlt")
    sheet.get_by_role("button", name="Next").click()
    page.wait_for_timeout(600)
    sheet.get_by_label("Sensor Name", exact=False).fill(args.sensor_name)
    sheet.get_by_label("Device ID", exact=False).fill(args.device_id)
    w.shot("Name und Geraete-ID eingetragen")
    created_at = time.time()
    sheet.get_by_role("button", name="Create Sensor").click()
    page.wait_for_timeout(4000)
    w.shot("Sensor angelegt", counted=False)

    # The hand-over to ingestion. Nothing is clicked here, the sweep does it.
    delay = wait_for_first_value(args.ts_dsn, args.device_id, timeout_s=150)
    proto.facts["first_value_after_create_s"] = (
        None if delay is None else round(time.time() - created_at, 1))
    proto.facts["metric_points"] = metric_points(args.core_dsn, args.device_id)

    asset = object_id_by_name(args.core_dsn, args.sensor_name)
    proto.facts["asset_id"] = asset
    if asset:
        page.goto(f"{base}/assets/{asset}", wait_until="domcontentloaded")
        page.wait_for_timeout(6000)
        try:
            page.get_by_role("button", name="1h", exact=True).click(timeout=10_000)
            page.wait_for_timeout(4000)
        except Exception:
            pass
        page.mouse.move(5, 5)
        w.shot("Messwerte des neuen Geraets sichtbar", counted=False)

    meter.stop()
    proto.facts["published_by_device"] = meter.published
    proto.facts["measurements_after"] = measurement_count(args.ts_dsn, args.device_id)
    proto.facts["after"] = snapshot()
    proto.facts["steps_counted"] = proto.total()
    return proto


# ── QS-MOD-02 ─────────────────────────────────────────────────────────────────

def run_mod_02(page: Page, args: argparse.Namespace) -> Protocol:
    out = RESULTS / "qs-mod-02" / "screenshots"
    out.mkdir(parents=True, exist_ok=True)
    proto = Protocol("QS-MOD-02", datetime.now().astimezone().isoformat())
    w = Walkthrough(page, out, proto)
    base = args.base_url
    for old in out.glob("*.png"):
        old.unlink()
    with psycopg.connect(args.core_dsn) as conn:
        if conn.execute("DELETE FROM anomaly_rules WHERE name = %s", (args.rule_name,)).rowcount:
            print("    removed the rule of a previous run")
        conn.commit()
    proto.facts["before"] = snapshot()

    page.goto(f"{base}/projects/{args.project_id}/ide", wait_until="domcontentloaded")
    page.get_by_role("button", name=args.boiler, exact=True).first.wait_for(timeout=40_000)
    w.shot("Projekt-IDE geoeffnet", counted=False)
    page.get_by_role("button", name=args.boiler, exact=True).first.click()
    page.get_by_text("Anomaly Rules").wait_for(timeout=30_000)
    page.wait_for_timeout(1500)
    section = page.locator("div", has=page.get_by_text("Anomaly Rules", exact=True)).last
    section.scroll_into_view_if_needed()
    w.shot("Anlage gewaehlt, bestehende Regeln sichtbar")

    # A new rule from a template with a parameter of our own
    page.get_by_title("Add anomaly rule").click()
    page.get_by_role("combobox").filter(has=page.locator("option", has_text="Heating despite warm weather")).first.wait_for(timeout=15_000)
    w.shot("Regelformular geoeffnet", counted=False)
    template_select = page.get_by_role("combobox").filter(
        has=page.locator("option", has_text="Heating despite warm weather")).first
    template_select.select_option(label="Heating despite warm weather")
    page.wait_for_timeout(500)
    w.shot("Erkennungsmuster gewaehlt")
    name_input = page.get_by_placeholder("e.g. Short cycling boiler")
    name_input.fill(args.rule_name)
    # Bind the required "switch" role to the boiler's burner channel, the
    # first option that names a switch-like metric, else the first channel.
    switch_select = page.get_by_role("combobox").filter(
        has=page.locator("option", has_text="Select channel…")).first
    chan = switch_channel(args.core_dsn, args.boiler_device)
    if chan is None:
        raise SystemExit(f"no metric point for {args.boiler_device}")
    switch_select.select_option(value=chan[0])
    proto.facts["bound_channel"] = {"metric_point_id": chan[0], "name": chan[1]}
    w.shot("Schaltsignal der Anlage gebunden")
    # The regulatory parameter: from which outdoor temperature on heating
    # counts as unnecessary. The form shows the template default as
    # placeholder, the value entered replaces it.
    t_warm = page.get_by_placeholder("20", exact=True).first
    t_warm.fill(str(args.t_warm_c))
    w.shot("Parameter Warmwetterschwelle eingetragen")
    add = page.get_by_role("button", name="Add Rule", exact=True)
    add.scroll_into_view_if_needed()
    add.click()
    page.get_by_text(args.rule_name).first.wait_for(timeout=20_000)
    page.get_by_text(args.rule_name).first.scroll_into_view_if_needed()
    page.wait_for_timeout(1000)
    w.shot("Neue Regel in der Liste", counted=False)

    rule = anomaly_rule(args.core_dsn, args.rule_name)
    proto.facts["new_rule"] = rule
    if rule:
        time.sleep(3)
        proto.facts["new_rule_on_topic"] = rule_on_topic(rule["id"])

    # Change an existing rule. The switch tombstones the rule on the topic
    # when disabled and republishes it when enabled, both without a restart.
    row = page.locator("div", has=page.get_by_text(args.existing_rule, exact=True)).filter(
        has=page.get_by_role("switch")).last
    toggle = row.get_by_role("switch").first
    toggle.scroll_into_view_if_needed()
    toggle.click()
    page.wait_for_timeout(1200)
    w.shot("Bestehende Regel deaktiviert")
    toggle.click()
    page.wait_for_timeout(1200)
    w.shot("Bestehende Regel wieder aktiviert")

    # A custom rule is composed in the condition builder. Open it through the
    # form's "Custom condition" template so the canvas itself is on record.
    page.get_by_title("Add anomaly rule").click()
    sel = page.get_by_role("combobox").filter(
        has=page.locator("option", has_text="Custom condition")).first
    try:
        sel.wait_for(timeout=5_000)
    except Exception:
        page.get_by_title("Add anomaly rule").click()
        sel.wait_for(timeout=10_000)
    sel.select_option(label="Custom condition")
    page.get_by_role("button", name="Open condition builder").click()
    page.get_by_text("Condition Builder").wait_for(timeout=15_000)
    page.wait_for_timeout(1500)
    w.shot("Condition Builder fuer eine freie Regel", counted=False)
    page.keyboard.press("Escape")
    page.wait_for_timeout(500)

    proto.facts["after"] = snapshot()
    proto.facts["steps_counted"] = proto.total()
    return proto


# ── main ──────────────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--only", choices=["mod-01", "mod-02"], help="run one scenario only")
    p.add_argument("--base-url", default="http://localhost:3000")
    p.add_argument("--email", default="admin@local")
    p.add_argument("--password", default="admin")
    p.add_argument("--core-dsn", default="postgresql://postgres:password@localhost:5432/digital_demon")
    p.add_argument("--ts-dsn", default="postgresql://postgres:password@localhost:5433/digital_demon_measurements")
    # QS-MOD-01
    p.add_argument("--device-id", default="wmz-001")
    p.add_argument("--publish-interval", type=float, default=5.0)
    p.add_argument("--template-name", default="Waermemengenzaehler WMZ")
    p.add_argument("--manufacturer", default="Engelmann")
    p.add_argument("--model", default="SensoStar U")
    p.add_argument("--sensor-type", default="Heat Meter")
    p.add_argument("--sensor-name", default="Waermemengenzaehler Heizkreis")
    p.add_argument("--location", default="Heizraum 001")
    # QS-MOD-02
    p.add_argument("--project-id", default=str(uuid.uuid5(UUID_NS, "gap:project")))
    p.add_argument("--boiler", default="Boiler 001")
    p.add_argument("--boiler-device", default="gap-boiler-001",
                   help="device id of that boiler, to bind its own channel")
    p.add_argument("--rule-name", default="Heizen ueber 18 Grad Aussentemperatur")
    p.add_argument("--t-warm-c", type=float, default=18.0)
    p.add_argument("--existing-rule", default="Short cycling (Boiler 001)")
    p.add_argument("--viewport", default="1440x900")
    p.add_argument("--headed", action="store_true")
    p.add_argument("--slow-mo", type=int, default=250)
    return p.parse_args()


def main() -> int:
    args = parse_args()
    width, height = (int(v) for v in args.viewport.split("x"))
    protocols: list[Protocol] = []

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=not args.headed, slow_mo=args.slow_mo)
        context = browser.new_context(viewport={"width": width, "height": height},
                                      device_scale_factor=2)
        page = context.new_page()
        login(page, args.base_url, args.email, args.password)

        runs = {"mod-01": run_mod_01, "mod-02": run_mod_02}
        for key, fn in runs.items():
            if args.only in (None, key):
                print(f"QS-{key.upper()}")
                proto = fn(page, args)
                protocols.append(proto)
                # Written right away, so a failure in the second scenario
                # never costs the first one its protocol.
                (RESULTS / proto.scenario.lower() / "protokoll.json").write_text(
                    json.dumps(asdict(proto), indent=2, ensure_ascii=False, default=str),
                    encoding="utf-8")
        browser.close()

    for proto in protocols:
        path = RESULTS / proto.scenario.lower() / "protokoll.json"
        same_code = (proto.facts["before"]["commit"] == proto.facts["after"]["commit"]
                     and not proto.facts["before"]["uncommitted_changes_in_services"]
                     and not proto.facts["after"]["uncommitted_changes_in_services"])
        same_containers = proto.facts["before"]["containers"] == proto.facts["after"]["containers"]
        print(f"\n{proto.scenario}: {proto.total()} Bedienschritte, "
              f"code unchanged={same_code}, containers unchanged={same_containers}")
        for k in ("first_value_after_create_s", "new_rule_on_topic"):
            if k in proto.facts:
                print(f"  {k}: {proto.facts[k]}")
        print(f"  protocol: {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
