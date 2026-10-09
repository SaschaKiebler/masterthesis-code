package com.heatingplatform.core.ontology;

import jakarta.persistence.*;
import lombok.Data;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "links")
@Data
public class Link {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "link_type_id", nullable = false)
    private LinkType linkType;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "source_object_id", nullable = false)
    private ObjectEntity source;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "target_object_id", nullable = false)
    private ObjectEntity target;

    @Column(columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private String properties;

    @Column(name = "created_at")
    private Instant createdAt;
}
