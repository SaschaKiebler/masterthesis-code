"""In-memory projection of the compacted rule.configured topic.

Core owns the rule config and publishes enabled rules (key = rule_id,
tombstone on delete/disable). The evaluator rebuilds its state by replaying
the topic from the beginning — event-carried state transfer, no registry
read. Mirrors the ingestion service's DeviceStateStore for device.configured.
"""

import asyncio
import logging
from dataclasses import dataclass

from aiokafka import AIOKafkaConsumer, TopicPartition

from ..config import settings
from ..proto_gen.detection.v1 import rule_config_pb2

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Rule:
    rule_id: str
    metric_point_id: str
    device_id: str
    metric_id: int
    operator: str
    threshold: float | None
    severity: str
    cooldown_seconds: int
    tenant_id: str


class RuleStore:
    """Rule state keyed by channel identity and by rule id.

    start() blocks until the topic has been replayed up to the high
    watermarks (same startup semantics as the ingestion config cache), then
    follows live updates in a background task.
    """

    def __init__(self) -> None:
        self._by_channel: dict[tuple[str, int], dict[str, Rule]] = {}
        self._by_id: dict[str, Rule] = {}
        self._consumer: AIOKafkaConsumer | None = None
        self._follow_task: asyncio.Task | None = None

    def rules_for(self, device_id: str, metric_id: int) -> list[Rule]:
        return list(self._by_channel.get((device_id, metric_id), {}).values())

    def get(self, rule_id: str) -> Rule | None:
        return self._by_id.get(rule_id)

    def __len__(self) -> int:
        return len(self._by_id)

    async def start(self) -> None:
        topic = settings.topic_rule_configured
        consumer = AIOKafkaConsumer(
            bootstrap_servers=settings.kafka_bootstrap_servers,
            enable_auto_commit=False,
            auto_offset_reset="earliest",
        )
        await consumer.start()
        self._consumer = consumer

        partitions = await self._wait_for_topic(consumer, topic)
        tps = [TopicPartition(topic, p) for p in partitions]
        consumer.assign(tps)
        for tp in tps:
            await consumer.seek_to_beginning(tp)
        end_offsets = await consumer.end_offsets(tps)

        remaining = {tp: end for tp, end in end_offsets.items() if end > 0}
        while remaining:
            batches = await consumer.getmany(timeout_ms=1000)
            for tp, messages in batches.items():
                for msg in messages:
                    self._apply(msg.key, msg.value)
                if tp in remaining and messages and messages[-1].offset + 1 >= remaining[tp]:
                    del remaining[tp]

        log.info("Rule store replayed: %d rules", len(self._by_id))
        self._follow_task = asyncio.create_task(self._follow(), name="rule-store-follow")

    async def stop(self) -> None:
        if self._follow_task:
            self._follow_task.cancel()
            try:
                await self._follow_task
            except asyncio.CancelledError:
                pass
        if self._consumer:
            await self._consumer.stop()

    async def _wait_for_topic(self, consumer: AIOKafkaConsumer, topic: str) -> set[int]:
        while True:
            partitions = consumer.partitions_for_topic(topic)
            if partitions:
                return partitions
            log.info("Waiting for topic %s to appear (owned by core)...", topic)
            await asyncio.sleep(2)
            await consumer.topics()  # refresh metadata

    async def _follow(self) -> None:
        assert self._consumer is not None
        while True:
            batches = await self._consumer.getmany(timeout_ms=1000)
            for messages in batches.values():
                for msg in messages:
                    self._apply(msg.key, msg.value)

    def _apply(self, key: bytes | None, value: bytes | None) -> None:
        if key is None:
            return
        rule_id = key.decode()
        if value is None:
            # Tombstone: rule deleted or disabled.
            rule = self._by_id.pop(rule_id, None)
            if rule is not None:
                channel = self._by_channel.get((rule.device_id, rule.metric_id))
                if channel is not None:
                    channel.pop(rule_id, None)
                    if not channel:
                        del self._by_channel[(rule.device_id, rule.metric_id)]
            return

        try:
            config = rule_config_pb2.RuleConfig.FromString(value)
        except Exception:
            log.warning("Undecodable rule config for key %s — ignoring", rule_id)
            return

        rule = Rule(
            rule_id=config.rule_id,
            metric_point_id=config.metric_point_id,
            device_id=config.device_id,
            metric_id=config.metric_id,
            operator=config.operator,
            threshold=config.threshold if config.HasField("threshold") else None,
            severity=config.severity,
            cooldown_seconds=config.cooldown_seconds,
            tenant_id=config.tenant_id,
        )
        previous = self._by_id.get(rule_id)
        if previous is not None and (previous.device_id, previous.metric_id) != (
            rule.device_id,
            rule.metric_id,
        ):
            old_channel = self._by_channel.get((previous.device_id, previous.metric_id))
            if old_channel is not None:
                old_channel.pop(rule_id, None)
                if not old_channel:
                    del self._by_channel[(previous.device_id, previous.metric_id)]
        self._by_id[rule_id] = rule
        self._by_channel.setdefault((rule.device_id, rule.metric_id), {})[rule_id] = rule
