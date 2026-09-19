# mock-service

Device-fleet mock for the heating-monitoring platform. It stands in for the **edge device** of the C4 diagram: simulated heating sites publish realistic telemetry to the MQTT broker, which the platform then ingests like real device traffic. It exists for functional E2E runs and for the load/scenario evaluation of the architecture (thesis FF3).

Not to be confused with `simulation-engine`, which will be the digital-twin/prediction service of the analytics family.

## What it simulates

Each **site** has a shared weather model (diurnal outdoor curve + noise) and

- **1 boiler controller** (generic JSON device, topic `<id>/data`): flow temperature follows an outdoor-reset heating curve, return = flow − spread, thermal power, pump state. Exercises ingestion's *generic* parser route. The document carries its own clock in `ts` (RFC 3339), the way a gateway-published payload does, so ingestion stamps the measurement with the send time and `received_at` stays free to record the system entry — that split is what makes transport latency measurable.
- **N Shelly Plus H&T room sensors** (Gen2 native topics `<id>/status/temperature:0`, `humidity:0`, `devicepower:0`): room temperature with first-order inertia toward a setpoint, humidity anti-correlated, slow battery drain. Exercises ingestion's *Shelly* parser route.
- optional **rogue devices** (`--rogue N`): publish like H&T sensors but are never commissioned, so ingestion must drop them and device-management must emit `device.discovered`.

### Fault injection

Faults bend the model so the seeded threshold rules fire deterministically (alert path evaluation):

| Fault | Target | Effect | Fires rule |
| --- | --- | --- | --- |
| `overheat` | rooms | room ramps to 32 °C within ~1–2 min | room temp `GT 28 CRITICAL` |
| `spread_collapse` | boilers | hydraulic short circuit: return ≈ flow, flow races to 68 °C | return temp `GT 62 WARNING` |
| `stuck` | any | keeps publishing frozen values, clock keeps running | (data-quality scenario) |
| `dropout` | any | stops publishing | (availability scenario) |

Fault targeting is deterministic (first N matching devices in fleet order), so runs are reproducible.

## Usage

```bash
cd applications/mock-service
python3 -m venv .venv && .venv/bin/pip install -e .

# inspect the fleet a scenario produces (no side effects)
.venv/bin/mock-service plan --sites 2 --rooms 2 --rogue 1

# commission the fleet in the platform DB (objects, physical_devices,
# metric_points, threshold_rules). device-management's next sweep (≤30 s)
# publishes device.configured; then ingestion accepts the traffic.
.venv/bin/mock-service seed --sites 2 --rooms 2

# GDPR reference inventory (QS-SEC-02): PERSON objects with RESIDES_IN links
# onto rooms, person i resides in room (i mod rooms)+1. Synthetic contact data
# (example.org). The deterministic ids double as the coverage target list for
# the privacy-endpoint evaluation.
.venv/bin/mock-service seed --sites 2 --rooms 2 --persons 2

# publish telemetry (Ctrl-C to stop; --duration for a fixed run)
.venv/bin/mock-service run --sites 2 --rooms 2 --interval 10

# alert-path scenario: one room overheats after 30 s for 90 s
.venv/bin/mock-service run --sites 2 --rooms 2 --interval 5 --duration 180 \
    --fault overheat:count=1,at=30,for=90

# everything from a file (flags still override)
.venv/bin/mock-service run --scenario scenarios/local-smoke.json

# clean up (deletes fleet objects; cascades to devices/metric points/rules,
# device-management then publishes device.configured tombstones)
.venv/bin/mock-service seed --remove
```

`seed` and `run` derive the fleet from the same parameters (`--prefix/--sites/--rooms`), so what is commissioned is exactly what publishes. All ids are deterministic (uuid5 of prefix + device id), which makes seeding idempotent and re-runnable.

## Load evaluation

Scale via `--sites/--rooms/--interval`; the fleet multiplexes over `--connections` MQTT connections, so thousands of devices are cheap. Steady state produces `sites × (1 + 2 × rooms) / interval` **messages** per second (plus a battery message every 10th tick per H&T).

The stats line every 10 s reports both units, because they differ by roughly a factor of 1.5 and the thesis scenarios are specified in measurements:

```
published=79 (2.7 msg/s) measurements=124 (4.2 val/s) queue=0 dropped=0 errors=0
```

A boiler document carries four measurements, a Shelly status one. `measurements` is what the platform persists as rows, so it — not `published` — is the load-side reference for the loss rate. The final line adds `seeded=…`, which excludes rogue devices (ingestion drops those by design, so they must not inflate the expected row count).

```bash
# ~101 msg/s: 100 sites × 5 rooms, 10 s interval, 8 connections
.venv/bin/mock-service seed --sites 100 --rooms 5
.venv/bin/mock-service run --sites 100 --rooms 5 --interval 10 --connections 8
```

## Configuration reference

Everything is a CLI flag or a scenario-file key (see `scenarios/local-smoke.json`): `prefix`, `sites`, `rooms_per_site`, `rogue`, `interval_s`, `duration_s`, `seed`, `broker_host/port` (`--broker host:port`), `connections`, `dsn`, `mean_outdoor_c`, `diurnal_amplitude_c`, `faults`.
