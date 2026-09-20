# Kernfunktionen im Code

Fünf Stellen tragen die Logik des Werkzeugs. Die Auszüge sind gekürzt, die
Zeilenangaben führen zur vollständigen Fassung. Alle Pfade liegen unter
`src/mock_service/`.

## 1. Flotte ableiten `build_fleet`

[fleet.py#L133-L177](../../../applications/mock-service/src/mock_service/fleet.py#L133-L177)

```python
def build_fleet(scenario: Scenario) -> list[DeviceSpec]:
    fleet: list[DeviceSpec] = []
    for site in range(1, scenario.sites + 1):
        fleet.append(DeviceSpec(
            device_id=f"{scenario.prefix}-boiler-{site:03d}", kind=KIND_BOILER, site_index=site, seeded=True,
            metrics=BOILER_METRICS, rules=BOILER_RULES, asset_type="BOILER", asset_name=f"Boiler {site:03d}",
        ))
        for room in range(1, scenario.rooms_per_site + 1):
            fleet.append(DeviceSpec(
                device_id=f"{scenario.prefix}-ht-{site:03d}-{room:02d}", kind=KIND_SHELLY_HT, site_index=site, seeded=True,
                metrics=SHELLY_HT_METRICS, rules=SHELLY_HT_RULES, asset_type="GENERIC_SENSOR",
                asset_name=f"Room Sensor {site:03d}-{room:02d}", room_index=room,
            ))
    for i in range(1, scenario.rogue + 1):
        fleet.append(DeviceSpec(
            device_id=f"{scenario.prefix}-rogue-{i:03d}", kind=KIND_SHELLY_HT,
            site_index=1 + (i - 1) % max(scenario.sites, 1), seeded=False, metrics=(), rules=(),
        ))
    return fleet
```

Die eine Wahrheit über die Flotte. `seed` und `run` rufen dieselbe Funktion
mit demselben Szenario, deshalb sendet genau das, was angelegt wurde. Die
Reihenfolge der Liste ist stabil und wichtig, weil die Störungen „die ersten
N Geräte“ treffen. Jede Metrik trägt `source` und `field` schon so, wie der
ingestion-service sie in der Signal-Map erwartet. Die IDs für Objekte,
Messpunkte und Regeln entstehen daneben aus `uuid5` über Präfix und
Geräte-ID, weshalb ein Seed beliebig oft wiederholt werden kann. Unbekannte
Geräte haben keine Metriken und keine Regeln, sie existieren nur auf dem
Broker.

## 2. Gerät anlegen `_seed_device`

[seed.py#L308-L406](../../../applications/mock-service/src/mock_service/seed.py#L308-L406)

```python
cur.execute("""
    INSERT INTO physical_devices (id, device_id, manufacturer, model, protocol, commissioned_at)
    VALUES (%s, %s, %s, %s, 'MQTT', now())
    ON CONFLICT (device_id) DO UPDATE
        SET protocol = 'MQTT', decommissioned_at = NULL, updated_at = now()
""", (device_object, spec.device_id, manufacturer, model))

for metric in spec.metrics:
    cur.execute("""
        INSERT INTO metric_points (id, device_id, metric_id, source, field, unit, quantity_id)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (device_id, metric_id) DO UPDATE
            SET source = EXCLUDED.source, field = EXCLUDED.field, unit = EXCLUDED.unit, ...
    """, (metric_object, spec.device_id, metric.metric_id, metric.source, metric.field, metric.unit, ...))

for rule in spec.rules:
    cur.execute("""
        INSERT INTO threshold_rules (id, metric_point_id, operator, threshold, severity, cooldown_seconds, enabled, tenant_id)
        VALUES (%s, %s, %s, %s, %s, %s, true, %s)
        ON CONFLICT (id) DO UPDATE SET threshold = EXCLUDED.threshold, ..., enabled = true
    """, (...))

_seed_anomaly_rules(cur, spec, prefix, tid, counts)
```

Der Seed schreibt genau die Tabellen, die device-management für die
Projektion liest. `physical_devices` mit `decommissioned_at = NULL` ist das
Gate, `metric_points` mit `source` und `field` ist die Signal-Map,
`threshold_rules` sind die Regeln, die core nach `rule.configured`
publiziert. Jede Anweisung ist ein Upsert, ein erneuter Seed nach einer
Änderung setzt ein abgemeldetes Gerät wieder frei und schaltet eine
deaktivierte Regel wieder ein. Zum Schluss bekommt jeder Kessel zwei
Anomalieregeln, gebunden an den Pumpenkanal, damit `short_cycle` und
`weather_heating` im analytics-service sofort etwas zu tun haben. Für den
ingestion-service ist erst der nächste Sweep von device-management
relevant, nicht der Seed selbst.

## 3. Nachrichten erzeugen `SimDevice._render`

[devices.py#L80-L124](../../../applications/mock-service/src/mock_service/devices.py#L80-L124)

```python
def _render(self, state: dict, now: datetime) -> list[tuple[str, str, int]]:
    if self._boiler is not None:
        return [(f"{self.device_id}/data",
                 _dump({**state, "ts": now.isoformat()}),
                 self._metric_count("data"))]

    messages = [
        (f"{self.device_id}/status/temperature:0",
         _dump({"id": 0, "tC": state["tC"], "tF": round(state["tC"] * 9 / 5 + 32, 1)}),
         self._metric_count("temperature:0")),
        (f"{self.device_id}/status/humidity:0",
         _dump({"id": 0, "rh": state["rh"]}),
         self._metric_count("humidity:0")),
    ]
    if self._ticks % BATTERY_EVERY_N_TICKS == 0:
        messages.append((f"{self.device_id}/status/devicepower:0",
                         _dump({"id": 0, "battery": {"V": state["battery_v"], "percent": state["battery_percent"]},
                                "external": {"present": False}}),
                         self._metric_count("devicepower:0")))
    return messages
```

Hier wird aus Modellzustand das, was ein echtes Gerät auf die Leitung legt.
Der Kessel bekommt eine Uhr in `ts`, die Shelly-Nachrichten bewusst nicht,
weil die echte Hardware keine sendet. Genau dieser Unterschied lässt die
Evaluation Transportzeit und Verarbeitungszeit trennen. Jede Nachricht trägt
außerdem mit, wie viele Messwerte sie enthält, abgeleitet aus derselben
Metrikliste, die der Seed angelegt hat. So zählt der Generator in derselben
Einheit wie die Plattform, und die Verlustrate vergleicht Messwerte mit
Messwerten statt Nachrichten mit Zeilen. Die Störung `stuck` ruft diese
Funktion mit dem eingefrorenen Zustand, aber frischer Uhr.

## 4. Sendetakt `_device_loop`

[runner.py#L70-L103](../../../applications/mock-service/src/mock_service/runner.py#L70-L103)
und
[`_publisher_worker`](../../../applications/mock-service/src/mock_service/runner.py#L105-L139)

```python
async def _device_loop(device, queue, interval, start_delay, stop, stats):
    await asyncio.wait_for(stop.wait(), timeout=start_delay)   # Phasenversatz je Gerät
    loop = asyncio.get_running_loop()
    next_tick = loop.time()
    while not stop.is_set():
        for topic, payload, metric_count in device.tick(datetime.now(timezone.utc), interval):
            try:
                queue.put_nowait((topic, payload, metric_count, device.spec.seeded))
            except asyncio.QueueFull:
                stats.dropped += 1
        next_tick += interval
        delay = next_tick - loop.time()
        if delay > 0:
            await asyncio.wait_for(stop.wait(), timeout=delay)
        else:
            next_tick = loop.time()   # überlastet, neu synchronisieren statt nachholen
```

Jedes Gerät ist eine eigene Aufgabe, die im festen Takt Nachrichten in eine
gemeinsame Warteschlange legt. Der Startversatz verteilt die Geräte
gleichmäßig über den ersten Takt, damit tausend Geräte nicht in derselben
Sekunde senden. Der Takt ist absolut geplant und driftet nicht, und wenn die
Schleife hinterherhinkt, setzt sie neu auf statt einen Schwall nachzuholen.
Die Warteschlange leeren wenige `_publisher_worker`, je einer pro
MQTT-Verbindung, mit QoS 1 und automatischem Wiederverbinden. Diese Trennung
ist der Grund, warum ein Laptop eine Flotte von tausenden Geräten über zwei
bis acht Verbindungen erzeugen kann.

## 5. Störungen planen `_select_targets` und `_fault_scheduler`

[runner.py#L51-L68](../../../applications/mock-service/src/mock_service/runner.py#L51-L68)
und
[#L141-L177](../../../applications/mock-service/src/mock_service/runner.py#L141-L177)

```python
def _select_targets(fault: FaultSpec, devices: list[SimDevice]) -> list[SimDevice]:
    if fault.target == "rooms":
        pool = [d for d in devices if d.spec.kind == KIND_SHELLY_HT and d.spec.seeded]
    elif fault.target == "boilers":
        pool = [d for d in devices if d.spec.kind == KIND_BOILER]
    else:
        pool = [d for d in devices if d.spec.seeded]
    if fault.site is not None:
        pool = [d for d in pool if d.spec.site_index == fault.site]
    n = fault.count if fault.count is not None else (math.ceil(fault.fraction * len(pool)) if fault.fraction else 1)
    return pool[: max(0, min(n, len(pool)))]

async def _fault_scheduler(scenario, devices, stop, stats):
    events = []
    for fault in scenario.faults:
        targets = _select_targets(fault, devices)
        events.append((fault.at_s, fault, targets, True))
        if fault.duration_s > 0:
            events.append((fault.at_s + fault.duration_s, fault, targets, False))
    events.sort(key=lambda e: e[0])
    for at_s, fault, targets, activate in events:
        # … bis at_s warten …
        for device in targets:
            device.fault = fault.type if activate else None
```

Störungen sind ein Zeitplan, kein Zufall. Aus jeder Störung werden ein
Einschalt- und optional ein Ausschaltereignis, sortiert nach Zeit, und der
Planer setzt zum jeweiligen Zeitpunkt nur ein Feld am Gerät. Das Modell in
`thermal.py` liest dieses Feld bei jedem Takt und verbiegt seine Kurve.
Die Zielauswahl nimmt immer die ersten passenden Geräte in
Flottenreihenfolge, deshalb trifft ein Lauf mit denselben Parametern
dieselben Geräte, und ein Ereignisprotokoll aus der Plattform lässt sich
gegen den Plan prüfen. Mit `site` lässt sich die Störung auf einen Standort
eingrenzen, was die Demo der Anomalieerkennung gezielt macht.
