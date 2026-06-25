package com.digitaldemon.core.event;

import com.digitaldemon.core.event.Event;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.Collection;
import java.util.Collections;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * EventRepository — native query access to the events TimescaleDB hypertable.
 * Uses EntityManager directly (same pattern as MeasurementRepository) because
 * the composite PK (id, time) and hypertable partitioning require native SQL.
 */
@Repository
public class EventRepository {

    @PersistenceContext
    private EntityManager entityManager;

    @SuppressWarnings("unchecked")
    public List<Event> findByObjectIdAndTimeRange(UUID objectId, Instant from, Instant to,
                                                  int limit, int offset) {
        String sql = """
            SELECT id, time, object_id, event_type, severity, summary, details,
                   source, source_id, resolved_at, resolved_by, resolution_note, tenant_id
            FROM events
            WHERE object_id = :objectId
              AND time >= :from
              AND time <= :to
            ORDER BY time DESC
            LIMIT :limit OFFSET :offset
            """;
        return entityManager.createNativeQuery(sql, Event.class)
            .setParameter("objectId", objectId)
            .setParameter("from", from)
            .setParameter("to", to)
            .setParameter("limit", limit)
            .setParameter("offset", offset)
            .getResultList();
    }

    @SuppressWarnings("unchecked")
    public List<Event> findByTenantAndTimeRange(UUID tenantId, Instant from, Instant to,
                                                List<String> eventTypes, List<String> severities,
                                                int limit, int offset) {
        String typeFilter = (eventTypes != null && !eventTypes.isEmpty())
            ? "AND event_type = ANY(:eventTypes)" : "";
        String severityFilter = (severities != null && !severities.isEmpty())
            ? "AND severity = ANY(:severities)" : "";

        String sql = """
            SELECT id, time, object_id, event_type, severity, summary, details,
                   source, source_id, resolved_at, resolved_by, resolution_note, tenant_id
            FROM events
            WHERE tenant_id = :tenantId
              AND time >= :from
              AND time <= :to
              %s %s
            ORDER BY time DESC
            LIMIT :limit OFFSET :offset
            """.formatted(typeFilter, severityFilter);

        var query = entityManager.createNativeQuery(sql, Event.class)
            .setParameter("tenantId", tenantId)
            .setParameter("from", from)
            .setParameter("to", to)
            .setParameter("limit", limit)
            .setParameter("offset", offset);
        if (eventTypes != null && !eventTypes.isEmpty()) {
            query.setParameter("eventTypes", eventTypes.toArray(new String[0]));
        }
        if (severities != null && !severities.isEmpty()) {
            query.setParameter("severities", severities.toArray(new String[0]));
        }
        return query.getResultList();
    }

    public void insertEvent(UUID objectId, String eventType, String severity, String summary,
                            String detailsJson, String source, UUID sourceId, UUID tenantId) {
        String sql = """
            INSERT INTO events (id, time, object_id, event_type, severity, summary, details,
                                source, source_id, tenant_id)
            VALUES (uuid_generate_v4(), NOW(), :objectId, :eventType, :severity, :summary,
                    CAST(:details AS jsonb), :source, :sourceId, :tenantId)
            """;
        entityManager.createNativeQuery(sql)
            .setParameter("objectId", objectId)
            .setParameter("eventType", eventType)
            .setParameter("severity", severity)
            .setParameter("summary", summary)
            .setParameter("details", detailsJson != null ? detailsJson : "{}")
            .setParameter("source", source)
            .setParameter("sourceId", sourceId)
            .setParameter("tenantId", tenantId)
            .executeUpdate();
    }

    public void insertEvent(UUID objectId, String eventType, String severity, String summary,
                            String detailsJson, String source, UUID sourceId, UUID tenantId,
                            Instant time) {
        String sql = """
            INSERT INTO events (id, time, object_id, event_type, severity, summary, details,
                                source, source_id, tenant_id)
            VALUES (uuid_generate_v4(), :time, :objectId, :eventType, :severity, :summary,
                    CAST(:details AS jsonb), :source, :sourceId, :tenantId)
            """;
        entityManager.createNativeQuery(sql)
            .setParameter("time", time)
            .setParameter("objectId", objectId)
            .setParameter("eventType", eventType)
            .setParameter("severity", severity)
            .setParameter("summary", summary)
            .setParameter("details", detailsJson != null ? detailsJson : "{}")
            .setParameter("source", source)
            .setParameter("sourceId", sourceId)
            .setParameter("tenantId", tenantId)
            .executeUpdate();
    }

    public int resolveEvent(UUID eventId, Instant time, UUID resolvedBy, String note) {
        String sql = """
            UPDATE events
            SET resolved_at = NOW(), resolved_by = :resolvedBy, resolution_note = :note
            WHERE id = :eventId AND time = :time AND resolved_at IS NULL
            """;
        return entityManager.createNativeQuery(sql)
            .setParameter("eventId", eventId)
            .setParameter("time", time)
            .setParameter("resolvedBy", resolvedBy)
            .setParameter("note", note)
            .executeUpdate();
    }

    /**
     * Find events for multiple objects within a time range, with optional severity and object ID filters.
     */
    @SuppressWarnings("unchecked")
    public List<Event> findByObjectIdsAndTimeRange(
            Collection<UUID> objectIds, Instant from, Instant to,
            List<String> severities, Collection<UUID> objectIdFilter,
            int limit, int offset) {
        if (objectIds == null || objectIds.isEmpty()) {
            return Collections.emptyList();
        }

        // If objectIdFilter is provided, intersect with project scope
        Collection<UUID> effectiveIds = (objectIdFilter != null && !objectIdFilter.isEmpty())
            ? objectIdFilter.stream().filter(objectIds::contains).toList()
            : objectIds;

        if (effectiveIds.isEmpty()) {
            return Collections.emptyList();
        }

        String severityFilter = (severities != null && !severities.isEmpty())
            ? "AND severity = ANY(:severities)" : "";

        String sql = """
            SELECT id, time, object_id, event_type, severity, summary, details,
                   source, source_id, resolved_at, resolved_by, resolution_note, tenant_id
            FROM events
            WHERE object_id IN :objectIds
              AND time >= :from
              AND time <= :to
              %s
            ORDER BY time DESC
            LIMIT :limit OFFSET :offset
            """.formatted(severityFilter);

        var query = entityManager.createNativeQuery(sql, Event.class)
            .setParameter("objectIds", effectiveIds)
            .setParameter("from", from)
            .setParameter("to", to)
            .setParameter("limit", limit)
            .setParameter("offset", offset);
        if (severities != null && !severities.isEmpty()) {
            query.setParameter("severities", severities.toArray(new String[0]));
        }
        return query.getResultList();
    }

    @SuppressWarnings("unchecked")
    public Optional<Event> findById(UUID eventId) {
        String sql = """
            SELECT id, time, object_id, event_type, severity, summary, details,
                   source, source_id, resolved_at, resolved_by, resolution_note, tenant_id
            FROM events WHERE id = :eventId LIMIT 1
            """;
        List<Event> results = entityManager.createNativeQuery(sql, Event.class)
            .setParameter("eventId", eventId)
            .getResultList();
        return results.isEmpty() ? Optional.empty() : Optional.of(results.get(0));
    }
}
