"""Weather-context anomaly detector (AT-09).

Evaluates burner cycling and switching behaviour exclusively in relation to
the outdoor temperature (thesis ch. 4.3/4.4.5). Two findings:

- short_cycle: switch-on edges per hour exceed the weather-dependent
  expectation allowed = base + max(0, 15 - t_out) * per_degree
- warm_weather_heating: sustained heating although the outdoor temperature
  is above the warm threshold

Findings leave the service as detection events on anomaly.detected. The
evaluation is a periodic task, decoupled from the measurement rate; observe()
only buffers.
"""

import asyncio
import json
import logging
import time
from collections import deque

from ..config import settings
from .devices import DeviceStore
from .publisher import DetectionPublisher
from .rules import RuleStore
from .weather import WeatherClient

log = logging.getLogger(__name__)

_SWITCH = "switch"
_FLOW = "flow"


class WeatherContextDetector:
    def __init__(
        self,
        device_store: DeviceStore,
        rule_store: RuleStore,
        publisher: DetectionPublisher,
        weather: WeatherClient,
    ) -> None:
        self._devices = device_store
        self._rules = rule_store
        self._publisher = publisher
        self._weather = weather
        # (device_id, metric_id) -> deque[(ts, value)], only the two signal classes
        self._buffers: dict[tuple[str, int], deque[tuple[float, float]]] = {}
        # (device_id, metric_id) -> signal class
        self._classes: dict[tuple[str, int], str] = {}
        # (device_id, finding kind) -> last fired (monotonic seconds)
        self._last_fired: dict[tuple[str, str], float] = {}
        # (device_id, metric_id) -> (metric_point_id, tenant_id) from the registry
        self._registry_context: dict[tuple[str, int], tuple[str, str]] = {}
        self._task: asyncio.Task | None = None

    # -- observation (called by the measurement consumer for every value) ----

    def observe(self, device_id: str, metric_id: int, value: float, ts: float | None) -> None:
        channel = (device_id, metric_id)
        signal_class = self._classes.get(channel)
        if signal_class is None:
            signal_class = self._classify(device_id, metric_id)
            self._classes[channel] = signal_class
        if signal_class == "":
            return

        buffer = self._buffers.get(channel)
        if buffer is None:
            buffer = deque()
            self._buffers[channel] = buffer
        buffer.append((ts if ts is not None else time.time(), value))
        self._trim(buffer)

    def _classify(self, device_id: str, metric_id: int) -> str:
        signal = self._devices.signal(device_id, metric_id)
        if signal is None:
            return ""
        unit = signal.unit.lower()
        name = signal.name.lower()
        if unit == "bool":
            return _SWITCH
        if unit == "celsius" and ("flow" in name or "vorlauf" in name):
            return _FLOW
        return ""

    @staticmethod
    def _trim(buffer: deque[tuple[float, float]]) -> None:
        cutoff = time.time() - settings.weather_window_minutes * 60
        while buffer and buffer[0][0] < cutoff:
            buffer.popleft()

    # -- periodic evaluation -------------------------------------------------

    def start(self) -> None:
        self._task = asyncio.create_task(self._run(), name="weather-context-detector")

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
                log.exception("Weather-context evaluation pass failed")

    async def evaluate_all(self) -> None:
        for device_id in {device for device, _ in self._buffers}:
            await self._evaluate_device(device_id)

    async def _evaluate_device(self, device_id: str) -> None:
        switch_channel = self._device_channel(device_id, _SWITCH)
        if switch_channel is None:
            return  # both findings are defined over the switching signal

        latitude, longitude = self._devices.coordinates(device_id)
        t_out = await self._weather.current_temperature(latitude, longitude)
        if t_out is None:
            return  # no outdoor temperature, no weather-contextual statement

        for buffer in self._buffers.values():
            self._trim(buffer)

        samples = sorted(self._buffers.get(switch_channel, ()))
        if len(samples) < 2:
            return

        window_hours = settings.weather_window_minutes / 60.0
        edges = sum(
            1
            for (_, prev), (_, cur) in zip(samples, samples[1:])
            if prev <= 0.5 < cur
        )
        cycles_per_hour = edges / window_hours
        duty_cycle = sum(1 for _, v in samples if v > 0.5) / len(samples)

        flow_channel = self._device_channel(device_id, _FLOW)
        flow_samples = self._buffers.get(flow_channel, ()) if flow_channel else ()
        flow_mean = (
            sum(v for _, v in flow_samples) / len(flow_samples) if flow_samples else None
        )

        allowed = settings.short_cycle_base + max(0.0, 15.0 - t_out) * settings.short_cycle_per_degree
        if cycles_per_hour > allowed:
            severity = "ERROR" if cycles_per_hour >= 1.5 * allowed else "WARNING"
            await self._publish(
                device_id,
                switch_channel[1],
                kind="short_cycle",
                severity=severity,
                summary="Short cycling: %.0f starts/h at %.1f °C outdoor (expected ≤ %.0f)"
                % (cycles_per_hour, t_out, allowed),
                detail={
                    "t_out": t_out,
                    "cycles_per_hour": round(cycles_per_hour, 2),
                    "allowed": round(allowed, 2),
                    "window_minutes": settings.weather_window_minutes,
                    "detector": "weather_context",
                },
            )

        if t_out >= settings.warm_no_heat_threshold_c and (
            duty_cycle > 0.5 or (flow_mean is not None and flow_mean > 45.0)
        ):
            await self._publish(
                device_id,
                switch_channel[1],
                kind="warm_weather_heating",
                severity="WARNING",
                summary="Heating active at %.1f °C outdoor (duty cycle %.2f)" % (t_out, duty_cycle),
                detail={
                    "t_out": t_out,
                    "duty_cycle": round(duty_cycle, 2),
                    "flow_mean": round(flow_mean, 2) if flow_mean is not None else None,
                    "window_minutes": settings.weather_window_minutes,
                    "detector": "weather_context",
                },
            )

    async def _registry_lookup(self, device_id: str, metric_id: int) -> tuple[str, str]:
        """(metric_point_id, tenant_id) of the channel from the master-data
        store; empty strings when unknown. Successful lookups are cached,
        failures are not (retried on the next finding)."""
        channel = (device_id, metric_id)
        cached = self._registry_context.get(channel)
        if cached is not None:
            return cached
        try:
            from ..db.pool import get_registry_pool

            pool = await get_registry_pool()
            row = await pool.fetchrow(
                """
                SELECT mp.id::text AS metric_point_id, o.tenant_id::text AS tenant_id
                FROM metric_points mp
                JOIN objects o ON o.id = mp.id
                WHERE mp.device_id = $1 AND mp.metric_id = $2
                """,
                device_id,
                metric_id,
            )
        except Exception:
            log.warning("Registry lookup failed for %s/%d", device_id, metric_id)
            return "", ""
        context = (
            (row["metric_point_id"] or "", row["tenant_id"] or "") if row else ("", "")
        )
        self._registry_context[channel] = context
        return context

    def _device_channel(self, device_id: str, signal_class: str) -> tuple[str, int] | None:
        for channel, cls in self._classes.items():
            if channel[0] == device_id and cls == signal_class:
                return channel
        return None

    async def _publish(
        self,
        device_id: str,
        metric_id: int,
        *,
        kind: str,
        severity: str,
        summary: str,
        detail: dict,
    ) -> None:
        now = time.monotonic()
        last = self._last_fired.get((device_id, kind))
        if last is not None and now - last < settings.weather_cooldown_seconds:
            return

        # Asset/tenant context: prefer a threshold rule on the exact channel,
        # otherwise resolve the channel's metric point from the registry store
        # (weather findings fire on the switch channel, which usually carries
        # no rule). Without asset_ref core skips the events projection; the
        # Meldung still reaches notification via tenant_id.
        rules = self._rules.rules_for(device_id, metric_id) or (
            [rule] if (rule := self._rules.any_rule_for_device(device_id)) else []
        )
        asset_ref = rules[0].metric_point_id if rules and rules[0].metric_id == metric_id else ""
        tenant_id = rules[0].tenant_id if rules else ""
        if not asset_ref or not tenant_id:
            registry_ref, registry_tenant = await self._registry_lookup(device_id, metric_id)
            asset_ref = asset_ref or registry_ref
            tenant_id = tenant_id or registry_tenant
        detail = {**detail, "kind": kind, "metric_point_id": asset_ref or None}

        event = self._publisher.build_event(
            topic=settings.topic_anomaly_detected,
            severity=severity,
            device_id=device_id,
            metric_id=metric_id,
            asset_ref=asset_ref,
            tenant_id=tenant_id,
            summary=summary,
            detail=json.dumps(detail, separators=(",", ":")),
        )
        await self._publisher.publish(event, settings.topic_anomaly_detected)
        self._last_fired[(device_id, kind)] = now
        log.info("Anomaly detected: %s device=%s (%s)", kind, device_id, summary)
