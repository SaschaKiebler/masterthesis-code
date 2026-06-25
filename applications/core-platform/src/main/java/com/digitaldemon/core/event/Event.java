package com.digitaldemon.core.event;

import jakarta.persistence.*;
import lombok.Data;
import lombok.EqualsAndHashCode;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.io.Serializable;
import java.time.Instant;
import java.util.UUID;

/**
 * Event entity mapping to the TimescaleDB hypertable.
 * Uses composite PK (id, time) as required by TimescaleDB hypertable partitioning.
 */
@Entity
@Table(name = "events")
@IdClass(Event.EventId.class)
@Data
public class Event {

    @Id
    private UUID id;

    @Id
    private Instant time;

    @Column(name = "object_id", nullable = false)
    private UUID objectId;

    @Column(name = "event_type", nullable = false)
    private String eventType; // 'FAULT', 'STATE_CHANGE', 'MAINTENANCE', 'THRESHOLD_BREACH', etc.

    @Column(nullable = false)
    private String severity; // 'DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'

    @Column(nullable = false)
    private String summary;

    @Column(columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private String details;

    @Column(nullable = false)
    private String source; // 'SYSTEM', 'DEVICE', 'USER', 'MODEL'

    @Column(name = "source_id")
    private UUID sourceId;

    @Column(name = "resolved_at")
    private Instant resolvedAt;

    @Column(name = "resolved_by")
    private UUID resolvedBy;

    @Column(name = "resolution_note")
    private String resolutionNote;

    @Column(name = "tenant_id", nullable = false)
    private UUID tenantId;

    @Data
    @EqualsAndHashCode
    public static class EventId implements Serializable {
        private UUID id;
        private Instant time;
    }
}
