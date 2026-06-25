package com.digitaldemon.core.measurement;

/**
 * Statistics for a single device + metric combination over a time range.
 * Used by the consultant analysis view.
 */
public record MeasurementStatisticsDTO(
    String deviceId,
    int metricId,
    String metricName,
    double min,
    double max,
    double avg,
    double stddev,
    long sampleCount
) {}
