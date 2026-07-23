"""Publishes detection events (shared envelope apis/proto/detection/v1),
keyed by device id. Fire-and-forget: a publish failure is logged and never
propagates into evaluation — same semantics as core's former publisher.
"""

import logging
import time

from aiokafka import AIOKafkaProducer

from ..config import settings
from ..proto_gen.detection.v1 import detection_event_pb2

log = logging.getLogger(__name__)


class DetectionPublisher:
    def __init__(self) -> None:
        self._producer: AIOKafkaProducer | None = None

    async def start(self) -> None:
        self._producer = AIOKafkaProducer(bootstrap_servers=settings.kafka_bootstrap_servers)
        await self._producer.start()

    async def stop(self) -> None:
        if self._producer:
            await self._producer.stop()

    def build_event(
        self,
        *,
        topic: str,
        severity: str,
        device_id: str,
        metric_id: int,
        asset_ref: str,
        tenant_id: str,
        summary: str,
        detail: str,
    ) -> detection_event_pb2.DetectionEvent:
        event = detection_event_pb2.DetectionEvent(
            type=topic,
            severity=severity,
            asset_ref=asset_ref,
            detail=detail,
            tenant_id=tenant_id,
            summary=summary,
        )
        event.channel.device_id = device_id
        event.channel.metric_id = metric_id
        now = time.time()
        event.detected_at.seconds = int(now)
        event.detected_at.nanos = int((now % 1) * 1e9)
        return event

    async def publish(self, event: detection_event_pb2.DetectionEvent, topic: str) -> None:
        if self._producer is None:
            return
        try:
            await self._producer.send_and_wait(
                topic,
                key=event.channel.device_id.encode(),
                value=event.SerializeToString(),
            )
        except Exception as e:  # noqa: BLE001 — fire-and-forget by design
            log.warning(
                "Failed to publish %s for device=%s — notification skipped: %s",
                topic,
                event.channel.device_id,
                e,
            )

    async def publish_raw(self, topic: str, key: bytes | None, value: bytes) -> None:
        """Used for forwarding poison messages to the DLQ unchanged."""
        if self._producer is None:
            return
        try:
            await self._producer.send_and_wait(topic, key=key, value=value)
        except Exception as e:  # noqa: BLE001
            log.warning("Failed to publish to %s: %s", topic, e)
