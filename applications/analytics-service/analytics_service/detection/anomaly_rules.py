"""In-memory projection of the compacted anomaly-rule.configured topic.

Core owns the anomaly-rule config (template instances with channel bindings)
and publishes enabled rules (key = rule_id, tombstone on delete/disable).
The anomaly engine rebuilds its state by replaying the topic — event-carried
state transfer, mirror of the threshold RuleStore.
"""

import json
import logging
from dataclasses import dataclass, field

from ..config import settings
from ..proto_gen.detection.v1 import anomaly_rule_config_pb2
from .compacted import CompactedStore

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Binding:
    role: str
    metric_point_id: str
    device_id: str
    metric_id: int

    @property
    def channel(self) -> tuple[str, int]:
        return (self.device_id, self.metric_id)


@dataclass(frozen=True)
class AnomalyRule:
    rule_id: str
    tenant_id: str
    name: str
    detector: str
    params: dict = field(default_factory=dict)
    bindings: tuple[Binding, ...] = ()
    severity: str = "WARNING"
    cooldown_seconds: int = 1800

    def binding(self, role: str) -> Binding | None:
        for b in self.bindings:
            if b.role == role:
                return b
        return None


class AnomalyRuleStore(CompactedStore):
    topic = settings.topic_anomaly_rule_configured

    def __init__(self) -> None:
        super().__init__()
        self._by_id: dict[str, AnomalyRule] = {}

    def all(self) -> list[AnomalyRule]:
        return list(self._by_id.values())

    def get(self, rule_id: str) -> AnomalyRule | None:
        return self._by_id.get(rule_id)

    def referenced_channels(self) -> set[tuple[str, int]]:
        """Every channel bound by at least one rule — the engine buffers
        exactly these."""
        return {
            binding.channel
            for rule in self._by_id.values()
            for binding in rule.bindings
        }

    def __len__(self) -> int:
        return len(self._by_id)

    async def start(self) -> None:
        await super().start()
        log.info("Anomaly-rule store replayed: %d rules", len(self._by_id))

    def _apply(self, key: bytes | None, value: bytes | None) -> None:
        if key is None:
            return
        rule_id = key.decode()
        if value is None:
            self._by_id.pop(rule_id, None)
            return

        try:
            config = anomaly_rule_config_pb2.AnomalyRuleConfig.FromString(value)
        except Exception:
            log.warning("Undecodable anomaly-rule config for key %s — ignoring", rule_id)
            return

        try:
            params = json.loads(config.params_json) if config.params_json else {}
        except json.JSONDecodeError:
            log.warning("Unreadable params JSON for anomaly rule %s — ignoring", rule_id)
            return

        self._by_id[rule_id] = AnomalyRule(
            rule_id=config.rule_id,
            tenant_id=config.tenant_id,
            name=config.name,
            detector=config.detector,
            params=params,
            bindings=tuple(
                Binding(
                    role=b.role,
                    metric_point_id=b.metric_point_id,
                    device_id=b.device_id,
                    metric_id=b.metric_id,
                )
                for b in config.bindings
            ),
            severity=config.severity or "WARNING",
            cooldown_seconds=config.cooldown_seconds or 1800,
        )
