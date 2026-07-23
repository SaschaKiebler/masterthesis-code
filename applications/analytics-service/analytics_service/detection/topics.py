"""Topic provisioning for the detection topics owned by this service.

Per the event-catalog ownership rule, topics are provisioned exclusively by
their producing service (auto-create is disabled broker-side). Analytics is
the producer of threshold.breached and anomaly.detected, so it creates them
on startup. The DLQ of its own subscription (measurement.ingested.dlq) is
already provisioned by core and only published to here.
"""

import logging

from aiokafka.admin import AIOKafkaAdminClient, NewTopic
from aiokafka.errors import TopicAlreadyExistsError

from ..config import settings

log = logging.getLogger(__name__)


async def ensure_detection_topics() -> None:
    admin = AIOKafkaAdminClient(bootstrap_servers=settings.kafka_bootstrap_servers)
    await admin.start()
    try:
        topics = [
            NewTopic(
                name=name,
                num_partitions=settings.topic_partitions,
                replication_factor=settings.topic_replicas,
            )
            for name in (settings.topic_threshold_breached, settings.topic_anomaly_detected)
        ]
        for topic in topics:
            try:
                await admin.create_topics([topic])
                log.info("Created topic %s", topic.name)
            except TopicAlreadyExistsError:
                pass
    finally:
        await admin.close()
