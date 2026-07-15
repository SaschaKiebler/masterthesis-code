"""Device emitters: turn model state into the MQTT messages real devices send.

Shelly H&T publishes Gen2 native topics (`<id>/status/temperature:0` etc.,
parsed by ingestion's Shelly route); the boiler controller publishes one JSON
document on `<id>/data` (ingestion's generic route). Together they exercise
both parser paths of the platform.
"""

from __future__ import annotations

import json
import random
from datetime import datetime

from .fleet import KIND_BOILER, KIND_SHELLY_HT, DeviceSpec
from .scenario import Scenario
from .thermal import BoilerModel, RoomModel, SiteEnvironment

BATTERY_EVERY_N_TICKS = 10  # devicepower is chatty on real devices only on change


def _dump(payload: dict) -> str:
    return json.dumps(payload, separators=(",", ":"))


class SimDevice:
    """One simulated device: `tick()` returns the (topic, payload) messages to publish."""

    def __init__(self, spec: DeviceSpec, env: SiteEnvironment, seed: int):
        self.spec = spec
        self.fault: str | None = None
        self._ticks = 0
        self._last: list[tuple[str, str]] = []
        rng = random.Random(f"{seed}:{spec.device_id}")
        if spec.kind == KIND_BOILER:
            self._boiler: BoilerModel | None = BoilerModel(env, rng)
            self._room: RoomModel | None = None
        elif spec.kind == KIND_SHELLY_HT:
            self._boiler = None
            self._room = RoomModel(env, rng)
        else:
            raise ValueError(f"unknown device kind {spec.kind}")

    @property
    def device_id(self) -> str:
        return self.spec.device_id

    def tick(self, now: datetime, dt: float) -> list[tuple[str, str]]:
        if self.fault == "dropout":
            return []
        if self.fault == "stuck" and self._last:
            return self._last  # keeps publishing, values frozen

        if self._boiler is not None:
            state = self._boiler.tick(now, dt, self.fault)
            messages = [(f"{self.device_id}/data", _dump(state))]
        else:
            assert self._room is not None
            state = self._room.tick(now, dt, self.fault)
            messages = [
                (
                    f"{self.device_id}/status/temperature:0",
                    _dump({"id": 0, "tC": state["tC"], "tF": round(state["tC"] * 9 / 5 + 32, 1)}),
                ),
                (
                    f"{self.device_id}/status/humidity:0",
                    _dump({"id": 0, "rh": state["rh"]}),
                ),
            ]
            if self._ticks % BATTERY_EVERY_N_TICKS == 0:
                messages.append(
                    (
                        f"{self.device_id}/status/devicepower:0",
                        _dump(
                            {
                                "id": 0,
                                "battery": {"V": state["battery_v"], "percent": state["battery_percent"]},
                                "external": {"present": False},
                            }
                        ),
                    )
                )

        self._ticks += 1
        self._last = messages
        return messages


def build_devices(scenario: Scenario, fleet: list[DeviceSpec]) -> list[SimDevice]:
    """Instantiate devices with one shared environment per site."""
    envs: dict[int, SiteEnvironment] = {}
    devices: list[SimDevice] = []
    for spec in fleet:
        env = envs.get(spec.site_index)
        if env is None:
            env = SiteEnvironment(
                spec.site_index, scenario.seed, scenario.mean_outdoor_c, scenario.diurnal_amplitude_c
            )
            envs[spec.site_index] = env
        devices.append(SimDevice(spec, env, scenario.seed))
    return devices
