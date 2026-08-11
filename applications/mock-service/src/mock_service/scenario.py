"""Scenario configuration: what fleet to simulate, how fast, and which faults to inject.

A scenario can come from CLI flags, a JSON file, or both (flags override the
file). The same scenario drives `seed` (DB commissioning) and `run` (MQTT
publishing), so both always agree on the fleet.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field, fields
from pathlib import Path
from typing import Any, Optional

VALID_FAULT_TYPES = ("overheat", "spread_collapse", "stuck", "dropout", "short_cycle")
VALID_FAULT_TARGETS = ("rooms", "boilers", "any")

# Default fault target per fault type (overridable via target=...)
DEFAULT_FAULT_TARGET = {
    "overheat": "rooms",
    "spread_collapse": "boilers",
    "stuck": "any",
    "dropout": "any",
    "short_cycle": "boilers",
}


@dataclass
class FaultSpec:
    """One fault injection: which devices, when, and for how long."""

    type: str
    target: str = ""          # rooms | boilers | any ("" = default for type)
    count: Optional[int] = None
    fraction: Optional[float] = None
    site: Optional[int] = None  # restrict to one site's devices (1-based index)
    at_s: float = 60.0
    duration_s: float = 0.0   # 0 = until the end of the run

    def __post_init__(self) -> None:
        if self.type not in VALID_FAULT_TYPES:
            raise ValueError(f"unknown fault type '{self.type}' (valid: {', '.join(VALID_FAULT_TYPES)})")
        if not self.target:
            self.target = DEFAULT_FAULT_TARGET[self.type]
        if self.target not in VALID_FAULT_TARGETS:
            raise ValueError(f"unknown fault target '{self.target}' (valid: {', '.join(VALID_FAULT_TARGETS)})")

    @staticmethod
    def parse(spec: str) -> "FaultSpec":
        """Parse a CLI fault spec: 'overheat:count=2,at=60,for=180,target=rooms'."""
        head, _, rest = spec.partition(":")
        kwargs: dict[str, Any] = {"type": head.strip()}
        if rest:
            for part in rest.split(","):
                key, _, value = part.partition("=")
                key = key.strip()
                value = value.strip()
                if key == "count":
                    kwargs["count"] = int(value)
                elif key == "fraction":
                    kwargs["fraction"] = float(value)
                elif key == "site":
                    kwargs["site"] = int(value)
                elif key == "at":
                    kwargs["at_s"] = float(value)
                elif key in ("for", "duration"):
                    kwargs["duration_s"] = float(value)
                elif key == "target":
                    kwargs["target"] = value
                else:
                    raise ValueError(f"unknown fault option '{key}' in '{spec}'")
        return FaultSpec(**kwargs)


@dataclass
class Scenario:
    """Full description of one mock run (fleet shape, pacing, environment, faults)."""

    # Fleet shape (drives both seeding and publishing)
    prefix: str = "mock"
    sites: int = 2
    rooms_per_site: int = 2
    rogue: int = 0            # extra UNSEEDED H&T devices (exercise drop + discovery path)
    persons_per_site: int = 0  # PERSON objects with RESIDES_IN links (GDPR path, QS-SEC-02)

    # Pacing
    interval_s: float = 10.0  # publish interval per device
    duration_s: float = 0.0   # 0 = run until interrupted
    seed: int = 42

    # Connections
    broker_host: str = "localhost"
    broker_port: int = 1883
    connections: int = 2      # MQTT publisher connections (fleet is multiplexed over them)
    dsn: str = "postgresql://postgres:password@localhost:5432/digital_demon"

    # Environment model
    mean_outdoor_c: float = 8.0
    diurnal_amplitude_c: float = 4.0

    faults: list[FaultSpec] = field(default_factory=list)

    @staticmethod
    def from_file(path: str | Path) -> "Scenario":
        data = json.loads(Path(path).read_text())
        return Scenario.from_dict(data)

    @staticmethod
    def from_dict(data: dict[str, Any]) -> "Scenario":
        known = {f.name for f in fields(Scenario)}
        unknown = set(data) - known
        if unknown:
            raise ValueError(f"unknown scenario keys: {', '.join(sorted(unknown))}")
        kwargs = dict(data)
        kwargs["faults"] = [
            f if isinstance(f, FaultSpec) else FaultSpec(**f) for f in data.get("faults", [])
        ]
        return Scenario(**kwargs)

    def apply_overrides(self, overrides: dict[str, Any]) -> None:
        """Overlay non-None CLI values on top of this scenario."""
        for key, value in overrides.items():
            if value is None:
                continue
            if key == "faults":
                if value:  # only replace when flags actually provided faults
                    self.faults = list(value)
                continue
            setattr(self, key, value)
