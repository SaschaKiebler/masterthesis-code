package com.digitaldemon.core.physicalquantity;

import jakarta.persistence.*;
import lombok.Data;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "physical_quantities")
@Data
public class PhysicalQuantity {

    @Id
    private UUID id; // Same UUID as objects.id — typed extension table pattern

    @Column(nullable = false, unique = true)
    private String name; // Machine key: 'flow_temperature', 'active_power'

    @Column(name = "display_name", nullable = false)
    private String displayName;

    @Column
    private String description;

    @Column(nullable = false)
    private String dimension; // 'TEMPERATURE', 'POWER', 'ENERGY', etc.

    @Column(name = "default_unit", nullable = false)
    private String defaultUnit;

    @Column(nullable = false)
    private String aggregation; // 'MEAN', 'SUM', 'LAST', 'MAX', 'MIN', 'COUNT'

    @Column
    private String domain; // 'HVAC', 'ELECTRICAL', 'WATER', 'ENVIRONMENTAL'

    @Column(name = "created_at")
    private Instant createdAt;
}
