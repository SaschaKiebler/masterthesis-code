"""Async run loop: device tasks feed a queue, a small pool of MQTT
connections drains it, a scheduler flips faults on and off, and a stats task
reports throughput. Designed so thousands of simulated devices multiplex over
a handful of broker connections.
"""

from __future__ import annotations

import asyncio
import logging
import math
from dataclasses import dataclass, field

import aiomqtt

from .devices import SimDevice, build_devices
from .fleet import KIND_BOILER, KIND_SHELLY_HT, build_fleet
from .scenario import FaultSpec, Scenario

log = logging.getLogger("mock")

QUEUE_MAX = 20_000
STATS_EVERY_S = 10.0


@dataclass
class RunStats:
    published: int = 0          # MQTT messages
    # Measurements inside those messages, counted from each device's metric
    # declaration. The load scenarios are specified in measurements per second,
    # and one boiler document carries four while a Shelly status carries one —
    # so this, not `published`, is the basis for the loss rate (P0.6).
    measurements: int = 0
    # Same, but only for commissioned devices. Rogue traffic is dropped by
    # ingestion on purpose, so it must not inflate the expected row count.
    seeded_measurements: int = 0
    dropped: int = 0
    publish_errors: int = 0
    active_faults: dict[str, int] = field(default_factory=dict)


def _select_targets(fault: FaultSpec, devices: list[SimDevice]) -> list[SimDevice]:
    """Deterministic fault targeting: first N matching devices in fleet order."""
    if fault.target == "rooms":
        pool = [d for d in devices if d.spec.kind == KIND_SHELLY_HT and d.spec.seeded]
    elif fault.target == "boilers":
        pool = [d for d in devices if d.spec.kind == KIND_BOILER]
    else:
        pool = [d for d in devices if d.spec.seeded]
    if fault.site is not None:
        pool = [d for d in pool if d.spec.site_index == fault.site]
    if fault.count is not None:
        n = fault.count
    elif fault.fraction is not None:
        n = math.ceil(fault.fraction * len(pool))
    else:
        n = 1
    return pool[: max(0, min(n, len(pool)))]


async def _device_loop(
    device: SimDevice,
    queue: asyncio.Queue,
    interval: float,
    start_delay: float,
    stop: asyncio.Event,
    stats: RunStats,
) -> None:
    try:
        await asyncio.wait_for(stop.wait(), timeout=start_delay)
        return  # stopped during ramp-up
    except asyncio.TimeoutError:
        pass
    from datetime import datetime, timezone

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
            try:
                await asyncio.wait_for(stop.wait(), timeout=delay)
                return
            except asyncio.TimeoutError:
                pass
        else:
            next_tick = loop.time()  # overloaded; resync instead of bursting


async def _publisher_worker(
    index: int, scenario: Scenario, queue: asyncio.Queue, stop: asyncio.Event, stats: RunStats
) -> None:
    """One MQTT connection draining the shared queue, reconnecting on error."""
    pending: tuple[str, str] | None = None
    while not (stop.is_set() and queue.empty() and pending is None):
        try:
            async with aiomqtt.Client(
                hostname=scenario.broker_host,
                port=scenario.broker_port,
                identifier=f"{scenario.prefix}-pub-{index}",
            ) as client:
                while True:
                    if pending is None:
                        try:
                            pending = await asyncio.wait_for(queue.get(), timeout=1.0)
                        except asyncio.TimeoutError:
                            if stop.is_set():
                                return
                            continue
                    await client.publish(pending[0], pending[1], qos=1)
                    stats.published += 1
                    stats.measurements += pending[2]
                    if pending[3]:
                        stats.seeded_measurements += pending[2]
                    queue.task_done()
                    pending = None
        except aiomqtt.MqttError as exc:
            stats.publish_errors += 1
            log.warning("publisher %d lost broker connection (%s), reconnecting in 2s", index, exc)
            try:
                await asyncio.wait_for(stop.wait(), timeout=2.0)
            except asyncio.TimeoutError:
                pass


async def _fault_scheduler(
    scenario: Scenario, devices: list[SimDevice], stop: asyncio.Event, stats: RunStats
) -> None:
    events: list[tuple[float, FaultSpec, list[SimDevice], bool]] = []
    for fault in scenario.faults:
        targets = _select_targets(fault, devices)
        if not targets:
            log.warning("fault %s matches no devices, skipping", fault.type)
            continue
        events.append((fault.at_s, fault, targets, True))
        if fault.duration_s > 0:
            events.append((fault.at_s + fault.duration_s, fault, targets, False))
    events.sort(key=lambda e: e[0])

    loop = asyncio.get_running_loop()
    t0 = loop.time()
    for at_s, fault, targets, activate in events:
        delay = at_s - (loop.time() - t0)
        if delay > 0:
            try:
                await asyncio.wait_for(stop.wait(), timeout=delay)
                return
            except asyncio.TimeoutError:
                pass
        for device in targets:
            device.fault = fault.type if activate else None
        stats.active_faults[fault.type] = stats.active_faults.get(fault.type, 0) + (
            len(targets) if activate else -len(targets)
        )
        log.info(
            "fault %s %s on %d device(s): %s",
            fault.type,
            "ACTIVATED" if activate else "cleared",
            len(targets),
            ", ".join(d.device_id for d in targets[:6]) + ("…" if len(targets) > 6 else ""),
        )


async def _stats_reporter(queue: asyncio.Queue, stop: asyncio.Event, stats: RunStats) -> None:
    loop = asyncio.get_running_loop()
    t0 = loop.time()
    last_published = 0
    last_measurements = 0
    while not stop.is_set():
        try:
            await asyncio.wait_for(stop.wait(), timeout=STATS_EVERY_S)
            return
        except asyncio.TimeoutError:
            pass
        rate = (stats.published - last_published) / STATS_EVERY_S
        measurement_rate = (stats.measurements - last_measurements) / STATS_EVERY_S
        last_published = stats.published
        last_measurements = stats.measurements
        faults = ", ".join(f"{k}×{v}" for k, v in stats.active_faults.items() if v > 0) or "none"
        log.info(
            "t=+%.0fs published=%d (%.1f msg/s) measurements=%d (%.1f val/s) "
            "queue=%d dropped=%d errors=%d faults=%s",
            loop.time() - t0,
            stats.published,
            rate,
            stats.measurements,
            measurement_rate,
            queue.qsize(),
            stats.dropped,
            stats.publish_errors,
            faults,
        )


async def run_scenario(scenario: Scenario) -> RunStats:
    fleet = build_fleet(scenario)
    devices = build_devices(scenario, fleet)
    queue: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_MAX)
    stop = asyncio.Event()
    stats = RunStats()

    seeded = sum(1 for d in devices if d.spec.seeded)
    log.info(
        "starting fleet: %d devices (%d seeded, %d rogue) over %d connection(s), interval %.1fs, %s",
        len(devices),
        seeded,
        len(devices) - seeded,
        scenario.connections,
        scenario.interval_s,
        f"duration {scenario.duration_s:.0f}s" if scenario.duration_s else "until interrupted",
    )

    tasks = [
        asyncio.create_task(_publisher_worker(i, scenario, queue, stop, stats))
        for i in range(scenario.connections)
    ]
    # Phase devices evenly across one interval so load is smooth, not bursty.
    tasks += [
        asyncio.create_task(
            _device_loop(
                device,
                queue,
                scenario.interval_s,
                start_delay=0.01 + (i / max(len(devices), 1)) * scenario.interval_s,
                stop=stop,
                stats=stats,
            )
        )
        for i, device in enumerate(devices)
    ]
    tasks.append(asyncio.create_task(_fault_scheduler(scenario, devices, stop, stats)))
    tasks.append(asyncio.create_task(_stats_reporter(queue, stop, stats)))

    try:
        if scenario.duration_s > 0:
            await asyncio.sleep(scenario.duration_s)
        else:
            await asyncio.Event().wait()  # forever, until KeyboardInterrupt
    except asyncio.CancelledError:
        pass
    finally:
        stop.set()
        try:
            await asyncio.wait_for(queue.join(), timeout=10.0)
        except asyncio.TimeoutError:
            log.warning("shutdown with %d unpublished messages in queue", queue.qsize())
        await asyncio.gather(*tasks, return_exceptions=True)
        # seeded_measurements is the number to compare against the row count in
        # the measurement store; rogue traffic is dropped by design.
        log.info(
            "run finished: published=%d measurements=%d (seeded=%d) dropped=%d errors=%d",
            stats.published,
            stats.measurements,
            stats.seeded_measurements,
            stats.dropped,
            stats.publish_errors,
        )
    return stats
