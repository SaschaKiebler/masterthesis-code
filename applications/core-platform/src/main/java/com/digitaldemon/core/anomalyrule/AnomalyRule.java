package com.digitaldemon.core.anomalyrule;

import jakarta.persistence.*;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.UUID;

/**
 * A user-configured anomaly rule: an instance of a detector template with
 * the template's roles bound to metric points. Parameters (and, for the
 * generic `condition` template, the condition tree) are kept as JSON so the
 * schema stays stable while the template library evolves.
 */
@Data
@NoArgsConstructor
@Entity
@Table(name = "anomaly_rules")
public class AnomalyRule {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "tenant_id", nullable = false)
    private UUID tenantId;

    @Column(nullable = false)
    private String name;

    /** Template key: short_cycle, weather_heating, actuator_without_demand, condition. */
    @Column(nullable = false)
    private String detector;

    /** Template parameters as a JSON object. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb", nullable = false)
    private String params = "{}";

    /**
     * JSON array of {"role": "...", "metricPointId": "..."}. The first
     * entry's metric point becomes the finding's asset_ref.
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb", nullable = false)
    private String bindings = "[]";

    /** Severity of the finding: INFO, WARNING, ERROR, CRITICAL. */
    @Column(nullable = false)
    private String severity = "WARNING";

    /** Minimum seconds between two findings of this rule. */
    @Column(name = "cooldown_seconds", nullable = false)
    private int cooldownSeconds = 1800;

    @Column(nullable = false)
    private boolean enabled = true;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
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
