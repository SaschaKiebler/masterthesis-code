package com.heatingplatform.core.ontology;

import com.heatingplatform.core.tenant.Tenant;

import jakarta.persistence.*;
import lombok.Data;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "object_types")
@Data
public class ObjectType {
    
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;
    
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "tenant_id")
    private Tenant tenant;
    
    @Column(nullable = false)
    private String name;
    
    @Column(name = "display_name", nullable = false)
    private String displayName;
    
    @Column(nullable = false)
    private String category;
    
    private String description;
    
    private String icon;

    @Column(name = "svg_icon_url")
    private String svgIconUrl;

    @Column(name = "property_schema", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private String propertySchema;
    
    @Column(name = "sort_order")
    private Integer sortOrder;
    
    @Column(nullable = false)
    private Boolean active = true;
    
    @Column(name = "created_at")
    private Instant createdAt;
    
    @Column(name = "updated_at")
    private Instant updatedAt;
}
