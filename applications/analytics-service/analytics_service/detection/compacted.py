"""Shared replay machinery for compacted configuration topics.

A CompactedStore rebuilds its in-memory state by replaying a compacted topic
from the beginning up to the high watermarks (blocking during startup, same
semantics as the ingestion service's device-state store), then follows live
updates in a background task. Subclasses implement _apply(key, value); a
value of None is a tombstone.
"""

import asyncio
import logging

from aiokafka import AIOKafkaConsumer, TopicPartition

from ..config import settings

log = logging.getLogger(__name__)


class CompactedStore:
    topic: str  # set by subclass

    def __init__(self) -> None:
        self._consumer: AIOKafkaConsumer | None = None
        self._follow_task: asyncio.Task | None = None

    def _apply(self, key: bytes | None, value: bytes | None) -> None:
        raise NotImplementedError

    async def start(self) -> None:
        consumer = AIOKafkaConsumer(
            bootstrap_servers=settings.kafka_bootstrap_servers,
            enable_auto_commit=False,
            auto_offset_reset="earliest",
        )
        await consumer.start()
        self._consumer = consumer

        partitions = await self._wait_for_topic(consumer)
        tps = [TopicPartition(self.topic, p) for p in partitions]
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

        self._follow_task = asyncio.create_task(
            self._follow(), name=f"{type(self).__name__}-follow"
        )

    async def stop(self) -> None:
        if self._follow_task:
            self._follow_task.cancel()
            try:
                await self._follow_task
            except asyncio.CancelledError:
                pass
        if self._consumer:
            await self._consumer.stop()

    async def _wait_for_topic(self, consumer: AIOKafkaConsumer) -> set[int]:
        while True:
            partitions = consumer.partitions_for_topic(self.topic)
            if partitions:
                return partitions
            log.info("Waiting for topic %s to appear (owned by its producer)...", self.topic)
            await asyncio.sleep(2)
            await consumer.topics()  # refresh metadata

    async def _follow(self) -> None:
        assert self._consumer is not None
        while True:
            batches = await self._consumer.getmany(timeout_ms=1000)
            for messages in batches.values():
                for msg in messages:
                    self._apply(msg.key, msg.value)
