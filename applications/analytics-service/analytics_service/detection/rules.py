"""In-memory projection of the compacted rule.configured topic.

Core owns the rule config and publishes enabled rules (key = rule_id,
tombstone on delete/disable). The evaluator rebuilds its state by replaying
the topic from the beginning — event-carried state transfer, no registry
read. Mirrors the ingestion service's DeviceStateStore for device.configured.
"""

import logging
from dataclasses import dataclass

from ..config import settings
from ..proto_gen.detection.v1 import rule_config_pb2
from .compacted import CompactedStore

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


class RuleStore(CompactedStore):
    """Rule state keyed by channel identity and by rule id."""

    topic = settings.topic_rule_configured

    def __init__(self) -> None:
        super().__init__()
        self._by_channel: dict[tuple[str, int], dict[str, Rule]] = {}
        self._by_id: dict[str, Rule] = {}

    def rules_for(self, device_id: str, metric_id: int) -> list[Rule]:
        return list(self._by_channel.get((device_id, metric_id), {}).values())

    def any_rule_for_device(self, device_id: str) -> Rule | None:
        """Any rule on any channel of the device — used by the weather
        detector to borrow tenant/asset context for its findings."""
        for (rule_device, _), rules in self._by_channel.items():
            if rule_device == device_id and rules:
                return next(iter(rules.values()))
        return None

    def get(self, rule_id: str) -> Rule | None:
        return self._by_id.get(rule_id)

    def __len__(self) -> int:
        return len(self._by_id)

    async def start(self) -> None:
        await super().start()
        log.info("Rule store replayed: %d rules", len(self._by_id))

    def _apply(self, key: bytes | None, value: bytes | None) -> None:
        if key is None:
            return
        rule_id = key.decode()
        if value is None:
            # Tombstone: rule deleted or disabled.
            rule = self._by_id.pop(rule_id, None)
            if rule is not None:
                self._drop_from_channel(rule_id, rule.device_id, rule.metric_id)
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
            self._drop_from_channel(rule_id, previous.device_id, previous.metric_id)
        self._by_id[rule_id] = rule
        self._by_channel.setdefault((rule.device_id, rule.metric_id), {})[rule_id] = rule

    def _drop_from_channel(self, rule_id: str, device_id: str, metric_id: int) -> None:
        channel = self._by_channel.get((device_id, metric_id))
        if channel is not None:
            channel.pop(rule_id, None)
            if not channel:
                del self._by_channel[(device_id, metric_id)]
