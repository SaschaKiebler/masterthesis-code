package com.digitaldemon.core.thresholdrule;

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

    /**
     * Returns true if this rule fires given the current measurement value and the
     * previous known value for the same metric point.
     *
     * Threshold rules (GT/LT/GTE/LTE) only need the current value.
     * State-change rules (CHANGED_TO_TRUE/FALSE) require a known previous value to
     * detect a transition — they return false on the very first measurement so we
     * don't fire on an unknown initial state.
     *
     * @param current  most recent measurement value
     * @param previous last known value, or null if this is the first measurement
     */
    public boolean isTriggered(double current, Double previous) {
        return switch (operator) {
            case "GT"  -> threshold != null && current > threshold;
            case "LT"  -> threshold != null && current < threshold;
            case "GTE" -> threshold != null && current >= threshold;
            case "LTE" -> threshold != null && current <= threshold;
            // Transition to TRUE (1): previous was falsy, current is truthy.
            // Require previous != null so we don't fire on initial state.
            case "CHANGED_TO_TRUE"  -> previous != null && current > 0.5 && previous <= 0.5;
            // Transition to FALSE (0): previous was truthy, current is falsy.
            case "CHANGED_TO_FALSE" -> previous != null && current <= 0.5 && previous > 0.5;
            default -> false;
        };
    }

    /** Human-readable label for event details. */
    public String direction() {
        return switch (operator) {
            case "GT", "GTE"          -> "ABOVE";
            case "CHANGED_TO_TRUE"    -> "ON";
            case "CHANGED_TO_FALSE"   -> "OFF";
            default                   -> "BELOW";
        };
    }
}
