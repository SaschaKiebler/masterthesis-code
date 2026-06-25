package com.digitaldemon.core.measurement;

import java.time.Instant;

public record MeasurementDTO(
    Instant time,
    String deviceId,
    int metricId,
    String metricName,
    double value
) {}
