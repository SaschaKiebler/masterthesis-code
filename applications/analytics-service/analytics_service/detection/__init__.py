"""Detection on the measurement path (thesis ch. 4).

The analytics service owns the measurement-path evaluation: it consumes
measurement.ingested, evaluates threshold rules (replayed from the compacted
rule.configured projection published by core) and publishes findings as
detection events on threshold.breached / anomaly.detected.
"""
