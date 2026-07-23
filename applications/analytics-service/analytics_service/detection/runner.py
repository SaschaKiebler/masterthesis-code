"""Lifecycle of the detection pipeline: producer, rule-store replay, main
consumer. Started from the FastAPI lifespan when kafka_enabled is true.
"""

import logging

from .consumer import MeasurementConsumer
from .evaluator import ThresholdEvaluator
from .publisher import DetectionPublisher
from .rules import RuleStore
from .topics import ensure_detection_topics

log = logging.getLogger(__name__)


class DetectionRunner:
    def __init__(self) -> None:
        self.publisher = DetectionPublisher()
        self.rule_store = RuleStore()
        self.evaluator = ThresholdEvaluator(self.rule_store)
        self.consumer = MeasurementConsumer(self.evaluator, self.publisher)

    async def start(self) -> None:
        await ensure_detection_topics()
        await self.publisher.start()
        await self.rule_store.start()
        await self.consumer.start()
        log.info("Detection pipeline started (%d rules)", len(self.rule_store))

    async def stop(self) -> None:
        await self.consumer.stop()
        await self.rule_store.stop()
        await self.publisher.stop()
        log.info("Detection pipeline stopped")
