"""Compact thermal model producing plausible heating telemetry.

Not building physics; just enough structure that the data behaves like a real
heating system: a diurnal outdoor curve, an outdoor-reset heating curve for
the boiler flow temperature, a flow/return spread under load, and rooms with
first-order inertia toward their setpoint. Faults bend the model toward the
seeded alert thresholds (see fleet.py) so alert scenarios are deterministic.
"""

from __future__ import annotations

import math
import random
from datetime import datetime

HEATING_LIMIT_C = 15.0        # heating off above this outdoor temperature
CURVE_BASE_C = 30.0           # heating curve: flow = base + slope * (20 - t_out)
CURVE_SLOPE = 1.3
FLOW_MIN_C, FLOW_MAX_C = 30.0, 70.0
DESIGN_SPREAD_K = 15.0

OVERHEAT_TARGET_C = 32.0      # room fault target (> 28 rule)
COLLAPSE_FLOW_TARGET_C = 68.0 # boiler fault: short circuit, return ≈ flow (> 62 rule)
FAULT_TAU_S = 60.0            # fast lag during faults, alert fires within ~1-2 min
SHORT_CYCLE_PERIOD_S = 120.0  # burner fault: one on/off cycle every 2 min (30 starts/h)


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _lag(current: float, target: float, dt: float, tau: float) -> float:
    """First-order lag of `current` toward `target` over timestep dt."""
    return current + (target - current) * (1.0 - math.exp(-dt / tau))


class SiteEnvironment:
    """Weather and heating state shared by all devices of one site."""

    def __init__(self, site_index: int, seed: int, mean_out_c: float, amplitude_c: float):
        self._rng = random.Random(f"{seed}:{site_index}:env")
        self._offset_c = self._rng.uniform(-2.0, 2.0)
        self._mean_c = mean_out_c
        self._amp_c = amplitude_c
        self._noise_c = 0.0
        self._cache_key: int | None = None
        self._cached: tuple[float, bool] = (mean_out_c, True)

    def sample(self, now: datetime) -> tuple[float, bool]:
        """(outdoor_c, heating_on), cached per second so every device of the
        site sees the same weather and the noise walk advances once per tick."""
        key = int(now.timestamp())
        if key == self._cache_key:
            return self._cached
        hour = now.hour + now.minute / 60.0 + now.second / 3600.0
        base = self._mean_c + self._amp_c * math.sin(math.pi * (hour - 9.0) / 12.0)
        self._noise_c = _clamp(self._noise_c + self._rng.uniform(-0.05, 0.05), -1.5, 1.5)
        t_out = base + self._offset_c + self._noise_c
        self._cache_key = key
        self._cached = (t_out, t_out < HEATING_LIMIT_C)
        return self._cached


class BoilerModel:
    """Outdoor-reset controlled heat generator with flow/return spread."""

    def __init__(self, env: SiteEnvironment, rng: random.Random):
        self._env = env
        self._rng = rng
        self._nominal_kw = rng.uniform(15.0, 40.0)
        self._phase = rng.uniform(0.0, 2.0 * math.pi)
        self._elapsed = 0.0
        self.flow_c = 40.0
        self.return_c = 28.0

    def tick(self, now: datetime, dt: float, fault: str | None) -> dict:
        t_out, heating_on = self._env.sample(now)
        self._elapsed += dt

        if fault == "spread_collapse":
            # Hydraulic short circuit: return water comes back nearly as hot as
            # it left, the boiler races toward its high limit.
            self.flow_c = _lag(self.flow_c, COLLAPSE_FLOW_TARGET_C, dt, FAULT_TAU_S)
            self.return_c = self.flow_c - 1.0
            spread = 1.0
        elif fault == "short_cycle":
            # Burner short cycling: the pump signal flips every half period,
            # far more starts per hour than any outdoor temperature justifies
            # (deterministic trigger for the weather-context detector, AT-09).
            heating_on = (self._elapsed % SHORT_CYCLE_PERIOD_S) < SHORT_CYCLE_PERIOD_S / 2
            target = _clamp(CURVE_BASE_C + CURVE_SLOPE * (20.0 - t_out), FLOW_MIN_C, FLOW_MAX_C)
            self.flow_c = _lag(self.flow_c, target, dt, 120.0) + self._rng.gauss(0.0, 0.15)
            spread = DESIGN_SPREAD_K if heating_on else 2.0
            self.return_c = self.flow_c - spread
        else:
            target = (
                _clamp(CURVE_BASE_C + CURVE_SLOPE * (20.0 - t_out), FLOW_MIN_C, FLOW_MAX_C)
                if heating_on
                else 22.0
            )
            self.flow_c = _lag(self.flow_c, target, dt, 120.0) + self._rng.gauss(0.0, 0.15)
            if heating_on:
                spread = _clamp(
                    DESIGN_SPREAD_K
                    + 2.5 * math.sin(self._elapsed / 900.0 + self._phase)
                    + self._rng.gauss(0.0, 0.4),
                    8.0,
                    20.0,
                )
            else:
                spread = 2.0
            self.return_c = self.flow_c - spread

        power_kw = self._nominal_kw * _clamp(spread / DESIGN_SPREAD_K, 0.0, 1.4) if heating_on else 0.0
        return {
            "flow_c": round(self.flow_c, 1),
            "return_c": round(self.return_c, 1),
            "power_kw": round(power_kw, 2),
            "pump": bool(heating_on),
        }


class RoomModel:
    """Room climate with inertia; humidity loosely anti-correlated with temperature."""

    def __init__(self, env: SiteEnvironment, rng: random.Random):
        self._env = env
        self._rng = rng
        self._setpoint = 21.0 + rng.uniform(-1.0, 1.5)
        self._rh_bias = rng.uniform(-5.0, 5.0)
        self.t_room = self._setpoint + rng.uniform(-0.5, 0.5)
        self.battery = rng.uniform(60.0, 100.0)

    def tick(self, now: datetime, dt: float, fault: str | None) -> dict:
        t_out, heating_on = self._env.sample(now)

        if fault == "overheat":
            self.t_room = _lag(self.t_room, OVERHEAT_TARGET_C, dt, FAULT_TAU_S)
        else:
            target = self._setpoint if heating_on else max(16.0, 0.25 * t_out + 12.0)
            self.t_room = _lag(self.t_room, target, dt, 600.0) + self._rng.gauss(0.0, 0.04)

        rh = _clamp(
            55.0 - 1.5 * (self.t_room - 20.0) + self._rh_bias + self._rng.gauss(0.0, 0.8),
            20.0,
            80.0,
        )
        # ~180-day battery life
        self.battery = max(5.0, self.battery - dt * 100.0 / (180.0 * 24.0 * 3600.0))
        return {
            "tC": round(self.t_room, 1),
            "rh": round(rh, 1),
            "battery_percent": int(self.battery),
            "battery_v": round(2.4 + 0.6 * self.battery / 100.0, 2),
        }
