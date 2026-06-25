package com.digitaldemon.core.device;

import com.digitaldemon.core.ontology.ObjectType;

import com.digitaldemon.core.tenant.Tenant;

import jakarta.persistence.*;
import lombok.Data;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "device_templates")
@Data
public class DeviceTemplate {
    
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;
    
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "tenant_id")
    private Tenant tenant;
    
    @Column(nullable = false)
    private String name;
    
    private String manufacturer;
    
    @Column(name = "model_number")
    private String modelNumber;
    
    private String description;
    
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "object_type_id")
    private ObjectType objectType;
    
    private String protocol;
    
    @Column(name = "default_signal_map", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private String defaultSignalMap;
    
    @Column(name = "default_specs", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private String defaultSpecs;
    
    @Column(name = "secrets_schema", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private String secretsSchema;
    
    @Column(name = "sort_order")
    private Integer sortOrder;
    
    @Column(nullable = false)
    private Boolean active = true;
    
    @Column(name = "created_at")
    private Instant createdAt;
    
    @Column(name = "updated_at")
    private Instant updatedAt;
}
