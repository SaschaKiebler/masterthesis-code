"""Lifecycle of the detection pipeline: producer, config-store replays, main
consumer, and the generic anomaly engine. Started from the FastAPI lifespan
when kafka_enabled is true.
"""

import logging

from ..config import settings
from .anomaly_rules import AnomalyRuleStore
from .consumer import MeasurementConsumer
from .devices import DeviceStore
from .engine import AnomalyEngine
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
        self.anomaly_rule_store = AnomalyRuleStore()
        self.device_store: DeviceStore | None = None
        self.weather: WeatherClient | None = None
        if settings.weather_enabled:
            self.device_store = DeviceStore()
            self.weather = WeatherClient()
        self.engine = AnomalyEngine(
            self.anomaly_rule_store,
            self.publisher,
            device_store=self.device_store,
            weather=self.weather,
        )
        self.consumer = MeasurementConsumer(
            self.evaluator,
            self.publisher,
            observer=self.engine.observe,
        )

    async def start(self) -> None:
        await ensure_detection_topics()
        await self.publisher.start()
        await self.rule_store.start()
        await self.anomaly_rule_store.start()
        if self.device_store is not None:
            await self.device_store.start()
        await self.consumer.start()
        self.engine.start()
        log.info(
            "Detection pipeline started (%d threshold rules, %d anomaly rules)",
            len(self.rule_store),
            len(self.anomaly_rule_store),
        )

    async def stop(self) -> None:
        await self.engine.stop()
        await self.consumer.stop()
        if self.device_store is not None:
            await self.device_store.stop()
        await self.anomaly_rule_store.stop()
        await self.rule_store.stop()
        await self.publisher.stop()
        if self.weather is not None:
            await self.weather.close()
        log.info("Detection pipeline stopped")
