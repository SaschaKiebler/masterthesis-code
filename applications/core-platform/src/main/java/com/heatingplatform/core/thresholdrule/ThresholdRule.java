package com.heatingplatform.core.thresholdrule;

import jakarta.persistence.*;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.UUID;

@Data
@NoArgsConstructor
@Entity
@Table(name = "threshold_rules")
public class ThresholdRule {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    /** The metric point this rule guards — references objects(id) via HAS_METRIC. */
    @Column(name = "metric_point_id", nullable = false)
    private UUID metricPointId;

    /** Comparison operator: GT, LT, GTE, LTE, CHANGED_TO_TRUE, CHANGED_TO_FALSE */
    @Column(nullable = false)
    private String operator;

    /**
     * Threshold value in the metric point's unit.
     * Null for state-change operators (CHANGED_TO_TRUE / CHANGED_TO_FALSE)
     * which compare current vs previous value, not against a fixed number.
     */
    @Column
    private Double threshold;

    /** Severity of the event fired on breach: INFO, WARNING, ERROR, CRITICAL. */
    @Column(nullable = false)
    private String severity = "WARNING";

    /** Minimum seconds between two events for this rule (spam guard). */
    @Column(name = "cooldown_seconds", nullable = false)
    private int cooldownSeconds = 300;

    @Column(nullable = false)
    private boolean enabled = true;

    @Column(name = "tenant_id", nullable = false)
    private UUID tenantId;

    @Column(name = "created_at", updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at")
    private Instant updatedAt;

    @PrePersist
    void prePersist() {
        createdAt = Instant.now();
        updatedAt = Instant.now();
    }

    @PreUpdate
    void preUpdate() {
        updatedAt = Instant.now();
    }
}
