"""Generic anomaly engine: evaluates user-configured anomaly rules.

Replaces the hardcoded weather-context detector. A rule is a detector
template instance (short_cycle, weather_heating, actuator_without_demand)
or a free condition tree (`condition` template); which channels are watched
follows from the rules' bindings, not from unit/name heuristics. Rules
arrive via the compacted anomaly-rule.configured topic (AnomalyRuleStore),
so configuration changes apply without a restart.

observe() only buffers; evaluation is a periodic task decoupled from the
measurement rate. Findings leave the service on anomaly.detected.
"""

import asyncio
import json
import logging
import time
from collections import deque

from ..config import settings
from .anomaly_rules import AnomalyRule, AnomalyRuleStore, Binding
from .devices import DeviceStore
from .publisher import DetectionPublisher
from .weather import WeatherClient

log = logging.getLogger(__name__)

_OPS = {
    "GT": lambda a, b: a > b,
    "LT": lambda a, b: a < b,
    "GTE": lambda a, b: a >= b,
    "LTE": lambda a, b: a <= b,
}

SUPPRESS_ROLE = "suppress_while"


class AnomalyEngine:
    def __init__(
        self,
        rule_store: AnomalyRuleStore,
        publisher: DetectionPublisher,
        device_store: DeviceStore | None = None,
        weather: WeatherClient | None = None,
    ) -> None:
        self._rules = rule_store
        self._publisher = publisher
        self._devices = device_store
        self._weather = weather
        # channel -> deque[(ts, value)], only channels some rule binds
        self._buffers: dict[tuple[str, int], deque[tuple[float, float]]] = {}
        self._watched: set[tuple[str, int]] = set()
        self._max_window_s: float = 3600.0
        # rule_id -> last fired (monotonic seconds)
        self._last_fired: dict[str, float] = {}
        self._task: asyncio.Task | None = None

    # -- observation (called by the measurement consumer for every value) ----

    def observe(self, device_id: str, metric_id: int, value: float, ts: float | None) -> None:
        channel = (device_id, metric_id)
        if channel not in self._watched:
            return
        buffer = self._buffers.get(channel)
        if buffer is None:
            buffer = deque()
            self._buffers[channel] = buffer
        buffer.append((ts if ts is not None else time.time(), value))
        self._trim(buffer)

    def _trim(self, buffer: deque[tuple[float, float]]) -> None:
        cutoff = time.time() - self._max_window_s
        while buffer and buffer[0][0] < cutoff:
            buffer.popleft()

    # -- lifecycle -----------------------------------------------------------

    def start(self) -> None:
        self.refresh_watch_set()
        self._task = asyncio.create_task(self._run(), name="anomaly-engine")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _run(self) -> None:
        while True:
            await asyncio.sleep(settings.weather_eval_interval_seconds)
            try:
                await self.evaluate_all()
            except Exception:  # noqa: BLE001 — the loop must survive
                log.exception("Anomaly evaluation pass failed")

    # -- evaluation ----------------------------------------------------------

    def refresh_watch_set(self) -> None:
        """Sync the watched channels and the retention window with the rule
        set; buffers of unbound channels are dropped."""
        self._watched = self._rules.referenced_channels()
        for channel in list(self._buffers):
            if channel not in self._watched:
                del self._buffers[channel]

        max_window = 3600.0
        for rule in self._rules.all():
            max_window = max(max_window, *self._rule_windows(rule))
        self._max_window_s = max_window

    @staticmethod
    def _rule_windows(rule: AnomalyRule) -> list[float]:
        windows = [60.0 * float(rule.params.get("window_minutes", 60.0))]
        condition = rule.params.get("condition")
        if isinstance(condition, dict):
            stack = [condition]
            while stack:
                node = stack.pop()
                children = node.get("all") or node.get("any")
                if isinstance(children, list):
                    stack.extend(c for c in children if isinstance(c, dict))
                elif "window_s" in node:
                    windows.append(float(node["window_s"]))
        return windows

    async def evaluate_all(self) -> None:
        self.refresh_watch_set()
        for buffer in self._buffers.values():
            self._trim(buffer)
        for rule in self._rules.all():
            try:
                await self._evaluate_rule(rule)
            except Exception:  # noqa: BLE001 — one broken rule must not stop the rest
                log.exception("Evaluation of anomaly rule %s failed", rule.rule_id)

    async def _evaluate_rule(self, rule: AnomalyRule) -> None:
        now = time.monotonic()
        last = self._last_fired.get(rule.rule_id)
        if last is not None and now - last < rule.cooldown_seconds:
            return

        suppress = rule.binding(SUPPRESS_ROLE)
        if suppress is not None:
            latest = self._last_value(suppress)
            if latest is not None and latest > 0.5:
                return

        finding = await self._dispatch(rule)
        if finding is None:
            return
        summary, detail = finding

        detail = {
            **detail,
            "kind": f"{rule.detector}:{rule.rule_id}",
            "anomaly_rule": rule.name,
            "detector": rule.detector,
            "metric_point_id": rule.bindings[0].metric_point_id,
        }
        event = self._publisher.build_event(
            topic=settings.topic_anomaly_detected,
            severity=rule.severity,
            device_id=rule.bindings[0].device_id,
            metric_id=rule.bindings[0].metric_id,
            asset_ref=rule.bindings[0].metric_point_id,
            tenant_id=rule.tenant_id,
            summary=summary,
            detail=json.dumps(detail, separators=(",", ":")),
        )
        await self._publisher.publish(event, settings.topic_anomaly_detected)
        self._last_fired[rule.rule_id] = now
        log.info("Anomaly rule fired: %s (%s) — %s", rule.name, rule.detector, summary)

    async def _dispatch(self, rule: AnomalyRule) -> tuple[str, dict] | None:
        if rule.detector == "short_cycle":
            return await self._short_cycle(rule)
        if rule.detector == "weather_heating":
            return await self._weather_heating(rule)
        if rule.detector == "actuator_without_demand":
            return self._actuator_without_demand(rule)
        if rule.detector == "condition":
            return await self._condition(rule)
        log.warning("Unknown detector '%s' in rule %s — skipping", rule.detector, rule.rule_id)
        return None

    # -- templates -----------------------------------------------------------

    async def _short_cycle(self, rule: AnomalyRule) -> tuple[str, dict] | None:
        switch = rule.binding("switch")
        if switch is None:
            return None
        t_out = await self._t_out(switch.device_id)
        if t_out is None:
            return None
        window_minutes = float(rule.params.get("window_minutes", 60.0))
        cycles = self._aggregate(switch, "edges_per_hour", window_minutes * 60.0)
        if cycles is None:
            return None
        base = float(rule.params.get("base_per_hour", 6.0))
        per_degree = float(rule.params.get("per_degree", 0.8))
        allowed = base + max(0.0, 15.0 - t_out) * per_degree
        if cycles <= allowed:
            return None
        summary = "Short cycling: %.0f starts/h at %.1f °C outdoor (expected ≤ %.0f)" % (
            cycles, t_out, allowed)
        return summary, {
            "t_out": t_out,
            "cycles_per_hour": round(cycles, 2),
            "allowed": round(allowed, 2),
            "window_minutes": window_minutes,
        }

    async def _weather_heating(self, rule: AnomalyRule) -> tuple[str, dict] | None:
        switch = rule.binding("switch")
        if switch is None:
            return None
        t_out = await self._t_out(switch.device_id)
        if t_out is None:
            return None
        t_warm = float(rule.params.get("t_warm_c", 20.0))
        if t_out < t_warm:
            return None
        window_s = 60.0 * float(rule.params.get("window_minutes", 60.0))
        duty = self._aggregate(switch, "duty", window_s)
        flow = rule.binding("flow")
        flow_mean = self._aggregate(flow, "mean", window_s) if flow else None
        min_duty = float(rule.params.get("min_duty", 0.5))
        min_flow = float(rule.params.get("min_flow_c", 45.0))
        heating = (duty is not None and duty > min_duty) or (
            flow_mean is not None and flow_mean > min_flow)
        if not heating:
            return None
        summary = "Heating active at %.1f °C outdoor (duty cycle %.2f)" % (t_out, duty or 0.0)
        return summary, {
            "t_out": t_out,
            "duty_cycle": round(duty, 2) if duty is not None else None,
            "flow_mean": round(flow_mean, 2) if flow_mean is not None else None,
        }

    def _actuator_without_demand(self, rule: AnomalyRule) -> tuple[str, dict] | None:
        demand = rule.binding("demand")
        actuator = rule.binding("actuator")
        if demand is None or actuator is None:
            return None
        window_minutes = float(rule.params.get("window_minutes", 30.0))
        window_s = window_minutes * 60.0
        demand_duty = self._aggregate(demand, "duty", window_s)
        actuator_duty = self._aggregate(actuator, "duty", window_s)
        if demand_duty is None or actuator_duty is None:
            return None
        if demand_duty > float(rule.params.get("max_demand_duty", 0.1)):
            return None
        if actuator_duty < float(rule.params.get("min_actuator_duty", 0.9)):
            return None
        summary = ("Actuator running without demand: actuator duty %.2f, "
                   "demand duty %.2f over %.0f min") % (actuator_duty, demand_duty, window_minutes)
        return summary, {
            "demand_duty": round(demand_duty, 2),
            "actuator_duty": round(actuator_duty, 2),
            "window_minutes": window_minutes,
        }

    async def _condition(self, rule: AnomalyRule) -> tuple[str, dict] | None:
        condition = rule.params.get("condition")
        if not isinstance(condition, dict):
            return None
        values: dict[str, float] = {}
        result = await self._eval_node(rule, condition, values)
        if not result:
            return None
        summary = "Condition rule '%s' matched (%s)" % (
            rule.name, ", ".join(f"{k}={v:.4g}" for k, v in values.items()))
        return summary, {"values": {k: round(v, 4) for k, v in values.items()}}

    async def _eval_node(self, rule: AnomalyRule, node: dict, values: dict[str, float]) -> bool:
        children = node.get("all")
        if isinstance(children, list):
            for child in children:
                if not await self._eval_node(rule, child, values):
                    return False
            return True
        children = node.get("any")
        if isinstance(children, list):
            for child in children:
                if await self._eval_node(rule, child, values):
                    return True
            return False

        agg = node.get("agg")
        op = _OPS.get(node.get("op", ""))
        target = node.get("value")
        if op is None or not isinstance(target, (int, float)):
            return False

        if agg == "t_out":
            t_out = await self._t_out(rule.bindings[0].device_id)
            if t_out is None:
                return False
            values["t_out"] = t_out
            return op(t_out, float(target))

        binding = rule.binding(str(node.get("role", "")))
        if binding is None:
            return False
        actual = self._aggregate(binding, str(agg), float(node.get("window_s", 3600)))
        if actual is None:
            return False
        values[f"{agg}({binding.role})"] = actual
        return op(actual, float(target))

    # -- aggregates and context ---------------------------------------------

    def _aggregate(self, binding: Binding, agg: str, window_s: float) -> float | None:
        buffer = self._buffers.get(binding.channel)
        if not buffer:
            return None
        cutoff = time.time() - window_s
        samples = [(ts, v) for ts, v in buffer if ts >= cutoff]
        if len(samples) < 2 and agg != "last":
            return None
        if agg == "last":
            return samples[-1][1] if samples else None
        values = [v for _, v in samples]
        if agg == "mean":
            return sum(values) / len(values)
        if agg == "min":
            return min(values)
        if agg == "max":
            return max(values)
        if agg == "duty":
            return sum(1 for v in values if v > 0.5) / len(values)
        if agg == "edges_per_hour":
            edges = sum(
                1 for (_, prev), (_, cur) in zip(samples, samples[1:]) if prev <= 0.5 < cur
            )
            return edges / (window_s / 3600.0)
        return None

    def _last_value(self, binding: Binding) -> float | None:
        buffer = self._buffers.get(binding.channel)
        return buffer[-1][1] if buffer else None

    async def _t_out(self, device_id: str) -> float | None:
        if self._weather is None or self._devices is None:
            return None
        latitude, longitude = self._devices.coordinates(device_id)
        return await self._weather.current_temperature(latitude, longitude)
