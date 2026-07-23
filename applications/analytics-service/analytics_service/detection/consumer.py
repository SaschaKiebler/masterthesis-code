"""Main measurement consumer: evaluates each batch against the rule store and
publishes findings on threshold.breached.

At-least-once: the offset is committed manually after evaluation; ordering
per device comes from the message key (device id). Undecodable payloads are
forwarded unchanged to measurement.ingested.dlq and committed — the same
poison-message behaviour core applies on this subscription.
"""

import asyncio
import logging

from aiokafka import AIOKafkaConsumer
from google.protobuf.message import DecodeError

from ..config import settings
from ..proto_gen.core.v1 import measurement_ingestion_pb2
from .evaluator import ThresholdEvaluator
from .publisher import DetectionPublisher

log = logging.getLogger(__name__)


class MeasurementConsumer:
    def __init__(
        self,
        evaluator: ThresholdEvaluator,
        publisher: DetectionPublisher,
        observer=None,
    ) -> None:
        """observer: optional callable (device_id, metric_id, value, ts_seconds)
        invoked for every measurement — feeds the weather-context detector."""
        self._evaluator = evaluator
        self._publisher = publisher
        self._observer = observer
        self._consumer: AIOKafkaConsumer | None = None
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        self._consumer = AIOKafkaConsumer(
            settings.topic_measurement_ingested,
            bootstrap_servers=settings.kafka_bootstrap_servers,
            group_id=settings.kafka_consumer_group,
            enable_auto_commit=False,
            auto_offset_reset="latest",
        )
        await self._consumer.start()
        self._task = asyncio.create_task(self._run(), name="measurement-consumer")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        if self._consumer:
            await self._consumer.stop()

    async def _run(self) -> None:
        assert self._consumer is not None
        dlq = settings.topic_measurement_ingested + ".dlq"
        async for msg in self._consumer:
            try:
                batch = measurement_ingestion_pb2.MeasurementBatch.FromString(msg.value)
            except DecodeError:
                log.warning(
                    "Undecodable MeasurementBatch at %s[%d]@%d — forwarding to DLQ",
                    msg.topic,
                    msg.partition,
                    msg.offset,
                )
                await self._publisher.publish_raw(dlq, msg.key, msg.value)
                await self._consumer.commit()
                continue

            try:
                await self._evaluate_batch(batch)
            except Exception:  # noqa: BLE001 — never wedge the consumer on one batch
                log.exception("Evaluation failed for device=%s", batch.device_id)
            await self._consumer.commit()

    async def _evaluate_batch(self, batch) -> None:
        device_id = batch.device_id
        batch_ts = batch.ingested_at.seconds if batch.HasField("ingested_at") else None
        for m in batch.measurements:
            ts = m.time.seconds if m.HasField("time") else batch_ts
            findings = self._evaluator.evaluate(device_id, m.metric_id, m.value)
            for finding in findings:
                event = self._publisher.build_event(
                    topic=settings.topic_threshold_breached,
                    severity=finding.severity,
                    device_id=device_id,
                    metric_id=m.metric_id,
                    asset_ref=finding.rule.metric_point_id,
                    tenant_id=finding.rule.tenant_id,
                    summary=finding.summary,
                    detail=finding.detail,
                )
                await self._publisher.publish(event, settings.topic_threshold_breached)
                log.info(
                    "Rule fired: device=%s metric_id=%d operator=%s severity=%s",
                    device_id,
                    m.metric_id,
                    finding.rule.operator,
                    finding.severity,
                )
            if self._observer is not None:
                self._observer(device_id, m.metric_id, m.value, ts)
