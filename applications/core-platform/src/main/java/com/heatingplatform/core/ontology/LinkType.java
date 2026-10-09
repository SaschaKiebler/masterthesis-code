package com.heatingplatform.core.ontology;

import jakarta.persistence.*;
import lombok.Data;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "link_types")
@Data
public class LinkType {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false, unique = true)
    private String name;

    @Column(name = "display_name", nullable = false)
    private String displayName;

    private String description;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "source_object_type_id")
    private ObjectType sourceObjectType;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "target_object_type_id")
    private ObjectType targetObjectType;

    @Column(name = "inverse_name")
    private String inverseName;

    @Column(name = "properties_schema", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private String propertiesSchema;

    @Column(name = "created_at")
    private Instant createdAt;
}
