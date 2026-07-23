"""Lifecycle of the detection pipeline: producer, config-store replays, main
consumer and the periodic weather-context detector. Started from the FastAPI
lifespan when kafka_enabled is true.
"""

import logging

from ..config import settings
from .consumer import MeasurementConsumer
from .detector import WeatherContextDetector
from .devices import DeviceStore
from .evaluator import ThresholdEvaluator
from .publisher import DetectionPublisher
from .rules import RuleStore
from .topics import ensure_detection_topics
from .weather import WeatherClient

log = logging.getLogger(__name__)


class DetectionRunner:
    def __init__(self) -> None:
        self.publisher = DetectionPublisher()
        self.rule_store = RuleStore()
        self.evaluator = ThresholdEvaluator(self.rule_store)
        self.detector: WeatherContextDetector | None = None
        self.weather: WeatherClient | None = None
        self.device_store: DeviceStore | None = None
        if settings.weather_enabled:
            self.device_store = DeviceStore()
            self.weather = WeatherClient()
            self.detector = WeatherContextDetector(
                self.device_store, self.rule_store, self.publisher, self.weather
            )
        self.consumer = MeasurementConsumer(
            self.evaluator,
            self.publisher,
            observer=self.detector.observe if self.detector else None,
        )

    async def start(self) -> None:
        await ensure_detection_topics()
        await self.publisher.start()
        await self.rule_store.start()
        if self.device_store is not None:
            await self.device_store.start()
        await self.consumer.start()
        if self.detector is not None:
            self.detector.start()
        log.info(
            "Detection pipeline started (%d rules, weather detector %s)",
            len(self.rule_store),
            "on" if self.detector else "off",
        )

    async def stop(self) -> None:
        if self.detector is not None:
            await self.detector.stop()
        await self.consumer.stop()
        if self.device_store is not None:
            await self.device_store.stop()
        await self.rule_store.stop()
        await self.publisher.stop()
        if self.weather is not None:
            await self.weather.close()
        log.info("Detection pipeline stopped")
