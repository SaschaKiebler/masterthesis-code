"""In-memory projection of the compacted device.configured topic.

Published by device-management; carries the signal map (metric name/unit,
used to classify channels for the weather-context detector) and, since the
weather-context rework, the site coordinates resolved from the ontology.
"""

import logging
from dataclasses import dataclass, field

from ..config import settings
from ..proto_gen.device.v1 import device_config_pb2
from .compacted import CompactedStore

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Signal:
    name: str
    unit: str


@dataclass(frozen=True)
class DeviceInfo:
    accepted: bool
    signals: dict[int, Signal] = field(default_factory=dict)
    latitude: float | None = None
    longitude: float | None = None


class DeviceStore(CompactedStore):
    topic = settings.topic_device_configured

    def __init__(self) -> None:
        super().__init__()
        self._devices: dict[str, DeviceInfo] = {}

    def get(self, device_id: str) -> DeviceInfo | None:
        return self._devices.get(device_id)

    def signal(self, device_id: str, metric_id: int) -> Signal | None:
        device = self._devices.get(device_id)
        return device.signals.get(metric_id) if device else None

    def coordinates(self, device_id: str) -> tuple[float, float]:
        """Site coordinates of the device, falling back to the configured
        default when the site has no location."""
        device = self._devices.get(device_id)
        if device and device.latitude is not None and device.longitude is not None:
            return device.latitude, device.longitude
        return settings.weather_default_latitude, settings.weather_default_longitude

    def __len__(self) -> int:
        return len(self._devices)

    async def start(self) -> None:
        await super().start()
        log.info("Device store replayed: %d devices", len(self._devices))

    def _apply(self, key: bytes | None, value: bytes | None) -> None:
        if key is None:
            return
        device_id = key.decode()
        if value is None:
            self._devices.pop(device_id, None)
            return

        try:
            config = device_config_pb2.DeviceConfig.FromString(value)
        except Exception:
            log.warning("Undecodable device config for key %s — ignoring", device_id)
            return

        self._devices[device_id] = DeviceInfo(
            accepted=config.accepted,
            signals={s.metric_id: Signal(name=s.name, unit=s.unit) for s in config.signals},
            latitude=config.site_latitude if config.HasField("site_latitude") else None,
            longitude=config.site_longitude if config.HasField("site_longitude") else None,
        )
