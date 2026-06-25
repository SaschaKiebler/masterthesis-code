package com.digitaldemon.core.kpiformula;

import jakarta.persistence.*;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.UUID;

/**
 * KpiFormula — a user-defined math formula that computes a KPI value from live sensor data.
 *
 * Each formula references one ontology object as its anchor (e.g. a heating circuit or building).
 * Variables bind to metric points either directly (by UUID) or via graph traversal (by link type
 * and physical quantity name). Results are persisted as derived_properties after evaluation.
 *
 * The {@code variables} JSONB column stores a map of variable name → binding descriptor:
 * <pre>
 * {
 *   "thermal_out": { "mode": "DIRECT",   "metricPointId": "uuid", "aggregation": "LAST" },
 *   "elec_in":     { "mode": "TRAVERSE", "linkTypeName": "FEEDS", "quantityName": "power",
 *                    "direction": "OUTBOUND", "aggregation": "SUM" }
 * }
 * </pre>
 */
@Data
@NoArgsConstructor
@Entity
@Table(name = "kpi_formulas")
public class KpiFormula {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    /** Anchor object this formula is attached to — references objects(id). */
    @Column(name = "object_id", nullable = false)
    private UUID objectId;

    /** Machine-readable key used as the derived property name (e.g. "cop", "efficiency_ratio"). */
    @Column(nullable = false)
    private String name;

    /** Human-readable label shown in the UI (e.g. "Coefficient of Performance"). */
    @Column(name = "display_name", nullable = false)
    private String displayName;

    /** Math formula string in exp4j syntax, referencing variable names (e.g. "thermal_out / elec_in"). */
    @Column(columnDefinition = "TEXT", nullable = false)
    private String formula;

    /**
     * JSONB map of variable bindings — maps formula variable names to their data source descriptors.
     * See class-level Javadoc for structure.
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "variables", columnDefinition = "jsonb", nullable = false)
    private String variables = "{}";

    /** Optional SI unit for the computed result (e.g. "dimensionless", "kWh", "percent"). */
    @Column
    private String unit;

    /** When false, the evaluator skips this formula during MQTT-triggered evaluation. */
    @Column(nullable = false)
    private boolean enabled = true;

    /** Tenant isolation — must match the tenant of the anchor object. */
    @Column(name = "tenant_id", nullable = false)
    private UUID tenantId;

    @Column(name = "created_at", updatable = false, nullable = false)
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
