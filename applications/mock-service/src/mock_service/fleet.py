"""Fleet derivation: one scenario deterministically defines the device fleet.

Both the DB seeder and the MQTT runner build the fleet from here, so what
gets commissioned is exactly what publishes. Device ids, object UUIDs and
rule UUIDs are all deterministic (uuid5 over prefix + device id), which makes
seeding idempotent and runs reproducible.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Optional

from .scenario import Scenario

# Fixed namespace for all mock-service uuid5 ids
UUID_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "digitaldemon:mock-service")

KIND_SHELLY_HT = "shelly-ht"
KIND_BOILER = "boiler"

# Thresholds the seeder provisions; fault injection is tuned to cross them.
ROOM_TEMP_ALERT_C = 28.0       # overheat fault ramps rooms to 32 °C
RETURN_TEMP_ALERT_C = 62.0     # spread collapse pushes return to ~67 °C
FLOW_TEMP_ALERT_C = 75.0       # safety limit, never crossed by the model (flow clamp 70)


@dataclass(frozen=True)
class MetricSpec:
    metric_id: int
    name: str
    unit: str
    source: str
    field: str
    quantity: Optional[str] = None  # display_name of a PHYSICAL_QUANTITY object, if present


@dataclass(frozen=True)
class RuleSpec:
    metric_id: int
    operator: str
    threshold: float
    severity: str
    cooldown_seconds: int = 300


@dataclass(frozen=True)
class DeviceSpec:
    device_id: str
    kind: str
    site_index: int
    seeded: bool
    metrics: tuple[MetricSpec, ...] = ()
    rules: tuple[RuleSpec, ...] = ()

    def object_id(self, prefix: str) -> uuid.UUID:
        return uuid.uuid5(UUID_NAMESPACE, f"{prefix}:device:{self.device_id}")

    def metric_object_id(self, prefix: str, metric_id: int) -> uuid.UUID:
        return uuid.uuid5(UUID_NAMESPACE, f"{prefix}:metric:{self.device_id}:{metric_id}")

    def rule_id(self, prefix: str, rule: RuleSpec) -> uuid.UUID:
        return uuid.uuid5(
            UUID_NAMESPACE,
            f"{prefix}:rule:{self.device_id}:{rule.metric_id}:{rule.operator}",
        )


SHELLY_HT_METRICS = (
    MetricSpec(1, "Room Temperature", "celsius", "temperature:0", "tC", "Room Temperature"),
    MetricSpec(2, "Relative Humidity", "percent", "humidity:0", "rh", None),
    MetricSpec(3, "Battery Level", "percent", "devicepower:0", "battery.percent", None),
)

SHELLY_HT_RULES = (
    RuleSpec(1, "GT", ROOM_TEMP_ALERT_C, "CRITICAL"),
)

BOILER_METRICS = (
    MetricSpec(1, "Flow Temperature", "celsius", "data", "flow_c", "Flow Temperature"),
    MetricSpec(2, "Return Temperature", "celsius", "data", "return_c", "Return Temperature"),
    MetricSpec(3, "Thermal Power", "kilowatt", "data", "power_kw", "Thermal Power"),
    MetricSpec(4, "Pump Running", "bool", "data", "pump", None),
)

BOILER_RULES = (
    RuleSpec(2, "GT", RETURN_TEMP_ALERT_C, "WARNING"),
    RuleSpec(1, "GT", FLOW_TEMP_ALERT_C, "CRITICAL"),
)


def tenant_id(prefix: str) -> uuid.UUID:
    return uuid.uuid5(UUID_NAMESPACE, f"{prefix}:tenant")


def build_fleet(scenario: Scenario) -> list[DeviceSpec]:
    """Derive the full device fleet in stable order (fault targeting relies on it)."""
    fleet: list[DeviceSpec] = []
    for site in range(1, scenario.sites + 1):
        fleet.append(
            DeviceSpec(
                device_id=f"{scenario.prefix}-boiler-{site:03d}",
                kind=KIND_BOILER,
                site_index=site,
                seeded=True,
                metrics=BOILER_METRICS,
                rules=BOILER_RULES,
            )
        )
        for room in range(1, scenario.rooms_per_site + 1):
            fleet.append(
                DeviceSpec(
                    device_id=f"{scenario.prefix}-ht-{site:03d}-{room:02d}",
                    kind=KIND_SHELLY_HT,
                    site_index=site,
                    seeded=True,
                    metrics=SHELLY_HT_METRICS,
                    rules=SHELLY_HT_RULES,
                )
            )
    # Rogue devices: publish like normal H&T sensors but are never seeded, so
    # ingestion must drop them and device-management must discover them.
    for i in range(1, scenario.rogue + 1):
        fleet.append(
            DeviceSpec(
                device_id=f"{scenario.prefix}-rogue-{i:03d}",
                kind=KIND_SHELLY_HT,
                site_index=1 + (i - 1) % max(scenario.sites, 1),
                seeded=False,
                metrics=(),
                rules=(),
            )
        )
    return fleet


def messages_per_interval(fleet: list[DeviceSpec]) -> int:
    """Steady-state MQTT messages per publish interval (battery cadence ignored)."""
    per_device = {KIND_SHELLY_HT: 2, KIND_BOILER: 1}
    return sum(per_device[d.kind] for d in fleet)
