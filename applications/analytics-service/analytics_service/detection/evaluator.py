"""Threshold-rule evaluation, ported from core's former MeasurementEventEvaluator
(reference: core-platform commit 082dd35).

Detail JSON and summary are format-compatible with the previous in-core
evaluator because the web app parses the event details.
"""

import json
import time
from dataclasses import dataclass

from .rules import Rule, RuleStore


@dataclass(frozen=True)
class Finding:
    """One fired rule, ready to be wrapped into a DetectionEvent envelope."""

    rule: Rule
    severity: str
    summary: str
    detail: str


def is_triggered(rule: Rule, value: float, previous: float | None) -> bool:
    op = rule.operator
    if op == "GT":
        return rule.threshold is not None and value > rule.threshold
    if op == "LT":
        return rule.threshold is not None and value < rule.threshold
    if op == "GTE":
        return rule.threshold is not None and value >= rule.threshold
    if op == "LTE":
        return rule.threshold is not None and value <= rule.threshold
    # State-change operators need a known previous value so the first
    # measurement after a restart never fires.
    if op == "CHANGED_TO_TRUE":
        return previous is not None and value > 0.5 and previous <= 0.5
    if op == "CHANGED_TO_FALSE":
        return previous is not None and value <= 0.5 and previous > 0.5
    return False


def direction(rule: Rule) -> str:
    op = rule.operator
    if op in ("GT", "GTE"):
        return "ABOVE"
    if op == "CHANGED_TO_TRUE":
        return "ON"
    if op == "CHANGED_TO_FALSE":
        return "OFF"
    return "BELOW"


class ThresholdEvaluator:
    """Stateful evaluator: cooldown per rule, last known value per channel.

    Both reset on restart — accepted, same as the former in-core evaluator.
    """

    def __init__(self, rule_store: RuleStore) -> None:
        self._rules = rule_store
        self._last_fired: dict[str, float] = {}
        self._last_value: dict[tuple[str, int], float] = {}

    def evaluate(self, device_id: str, metric_id: int, value: float) -> list[Finding]:
        rules = self._rules.rules_for(device_id, metric_id)
        if not rules:
            return []

        channel = (device_id, metric_id)
        previous = self._last_value.get(channel)
        findings: list[Finding] = []
        now = time.time()

        for rule in rules:
            if not is_triggered(rule, value, previous):
                continue
            last = self._last_fired.get(rule.rule_id)
            if last is not None and now - last < rule.cooldown_seconds:
                continue

            state_change = rule.operator.startswith("CHANGED_TO")
            if state_change:
                detail = json.dumps(
                    {
                        "value": value,
                        "previous": previous,
                        "direction": direction(rule),
                        "operator": rule.operator,
                        "metric_point_id": rule.metric_point_id,
                    },
                    separators=(",", ":"),
                )
                summary = f"State changed to {direction(rule)} on metric {rule.metric_point_id}"
            else:
                detail = json.dumps(
                    {
                        "value": value,
                        "threshold": rule.threshold,
                        "direction": direction(rule),
                        "operator": rule.operator,
                        "metric_point_id": rule.metric_point_id,
                    },
                    separators=(",", ":"),
                )
                summary = "Value %.4g %s threshold %.4g on metric %s" % (
                    value,
                    direction(rule).lower(),
                    rule.threshold,
                    rule.metric_point_id,
                )

            findings.append(
                Finding(rule=rule, severity=rule.severity, summary=summary, detail=detail)
            )
            self._last_fired[rule.rule_id] = now

        # Always update the last known value, even when nothing fired.
        self._last_value[channel] = value
        return findings
