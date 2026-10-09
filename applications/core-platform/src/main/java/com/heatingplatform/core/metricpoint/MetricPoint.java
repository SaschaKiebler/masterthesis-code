package com.heatingplatform.core.metricpoint;

import jakarta.persistence.*;
import lombok.Data;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "metric_points")
@Data
public class MetricPoint {

    @Id
    private UUID id; // Same UUID as objects.id — typed extension table pattern

    // Ingestion routing — replaces signal_map lookup
    @Column(name = "device_id", nullable = false)
    private String deviceId;

    @Column(name = "metric_id", nullable = false)
    private Short metricId;

    // Source mapping from ADR-010 signal_map entries
    @Column
    private String source; // MQTT component/topic segment, e.g. 'em:0', 'temperature:0'

    @Column
    private String field; // JSON field path within payload, e.g. 'aenergy.total'

    // Physical semantics — replaces signal_map name/unit
    @Column(name = "quantity_id")
    private UUID quantityId; // References objects.id of a PHYSICAL_QUANTITY object

    @Column(nullable = false)
    private String unit; // SI unit: 'celsius', 'ampere', 'watt', 'percent'

    // Operational bounds
    @Column(name = "min_value")
    private Double minValue;

    @Column(name = "max_value")
    private Double maxValue;

    @Column(name = "precision_digits")
    private Short precisionDigits;

    // Sampling metadata (for ML: know the expected data cadence)
    @Column(name = "sample_interval_seconds")
    private Integer sampleIntervalSeconds;

    @Column(name = "created_at")
    private Instant createdAt;

    @Column(name = "updated_at")
    private Instant updatedAt;
}
