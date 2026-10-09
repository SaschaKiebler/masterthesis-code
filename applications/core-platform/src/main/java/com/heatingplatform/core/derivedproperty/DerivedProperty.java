package com.heatingplatform.core.derivedproperty;

import jakarta.persistence.*;
import lombok.Data;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "derived_properties")
@Data
public class DerivedProperty {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "object_id", nullable = false)
    private UUID objectId;

    @Column(name = "property_name", nullable = false)
    private String propertyName; // Machine key: 'efficiency_score', 'predicted_failure_probability'

    @Column(name = "display_name", nullable = false)
    private String displayName;

    @Column(name = "value_numeric")
    private Double valueNumeric;

    @Column(name = "value_text")
    private String valueText;

    @Column(name = "value_json", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private String valueJson;

    @Column
    private String unit;

    @Column
    private Double confidence; // 0.0–1.0 model confidence

    @Column
    private String quality; // 'GOOD', 'STALE', 'LOW_CONFIDENCE', 'INSUFFICIENT_DATA'

    @Column(name = "source_type", nullable = false)
    private String sourceType; // 'RULE', 'PIPELINE', 'MODEL', 'AGGREGATION'

    @Column(name = "source_id")
    private String sourceId;

    @Column(name = "source_version")
    private String sourceVersion;

    @Column(name = "computed_at", nullable = false)
    private Instant computedAt;

    @Column(name = "valid_from", nullable = false)
    private Instant validFrom;

    @Column(name = "valid_until")
    private Instant validUntil; // NULL = current value

    @Column(name = "tenant_id", nullable = false)
    private UUID tenantId;
}
