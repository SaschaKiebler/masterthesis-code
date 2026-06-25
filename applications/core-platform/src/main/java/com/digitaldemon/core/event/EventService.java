package com.digitaldemon.core.event;

import com.digitaldemon.core.common.exception.ResourceNotFoundException;
import com.digitaldemon.core.event.EventRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Slf4j
@Transactional(readOnly = true)
public class EventService {

    private final EventRepository eventRepository;

    /**
     * Fetch events for a specific object within a time window.
     */
    public List<?> getEventsForObject(UUID objectId, Instant from, Instant to,
                                      int limit, int offset) {
        Instant end = to != null ? to : Instant.now();
        Instant start = from != null ? from : end.minus(30, ChronoUnit.DAYS);
        return eventRepository.findByObjectIdAndTimeRange(objectId, start, end, limit, offset);
    }

    /**
     * Query events across a tenant with optional filters.
     */
    public List<?> queryEvents(UUID tenantId, Instant from, Instant to,
                                List<String> eventTypes, List<String> severities,
                                int limit, int offset) {
        Instant end = to != null ? to : Instant.now();
        Instant start = from != null ? from : end.minus(30, ChronoUnit.DAYS);
        return eventRepository.findByTenantAndTimeRange(tenantId, start, end,
            eventTypes, severities, limit, offset);
    }

    /**
     * Record an operational event on an ontology object.
     * Used by ingestion service (automatic) and API (manual events like MAINTENANCE).
     */
    @Transactional
    public void recordEvent(UUID objectId, String eventType, String severity, String summary,
                             String detailsJson, String source, UUID sourceId, UUID tenantId) {
        eventRepository.insertEvent(objectId, eventType, severity, summary,
            detailsJson, source, sourceId, tenantId);
        log.info("Recorded event: type={}, severity={}, object={}", eventType, severity, objectId);
    }

    /**
     * Record an operational event with a custom timestamp.
     * Null time falls back to Instant.now().
     */
    @Transactional
    public void recordEvent(UUID objectId, String eventType, String severity, String summary,
                             String detailsJson, String source, UUID sourceId, UUID tenantId,
                             Instant time) {
        if (time == null) {
            recordEvent(objectId, eventType, severity, summary, detailsJson, source, sourceId, tenantId);
            return;
        }
        eventRepository.insertEvent(objectId, eventType, severity, summary,
            detailsJson, source, sourceId, tenantId, time);
        log.info("Recorded event: type={}, severity={}, object={}, time={}", eventType, severity, objectId, time);
    }

    /**
     * Mark an event as resolved with a note.
     */
    @Transactional
    public void resolveEvent(UUID eventId, Instant eventTime, UUID resolvedBy, String note) {
        int updated = eventRepository.resolveEvent(eventId, eventTime, resolvedBy, note);
        if (updated == 0) {
            throw new ResourceNotFoundException("Event not found or already resolved: " + eventId);
        }
        log.info("Resolved event: {}", eventId);
    }

    /**
     * Convenience method for the ingestion service: record a FAULT event.
     */
    @Transactional
    public void recordFault(UUID objectId, String faultCode, String description,
                             UUID metricPointId, UUID tenantId) {
        String details = """
            {"fault_code":"%s","description":"%s"}
            """.formatted(faultCode, description).strip();
        recordEvent(objectId, "FAULT", "ERROR",
            "Fault " + faultCode + ": " + description,
            details, "DEVICE", metricPointId, tenantId);
    }

    /**
     * Record a STATE_CHANGE event (pump ON→OFF, valve OPEN→CLOSED, etc.).
     */
    @Transactional
    public void recordStateChange(UUID objectId, String previousState, String newState,
                                   UUID metricPointId, UUID tenantId) {
        String details = """
            {"previous_state":"%s","new_state":"%s"}
            """.formatted(previousState, newState).strip();
        recordEvent(objectId, "STATE_CHANGE", "INFO",
            "State changed: " + previousState + " → " + newState,
            details, "DEVICE", metricPointId, tenantId);
    }

    /**
     * Record a THRESHOLD_BREACH event.
     */
    @Transactional
    public void recordThresholdBreach(UUID objectId, double value, double threshold,
                                       String direction, UUID metricPointId, UUID tenantId) {
        String details = """
            {"value":%s,"threshold":%s,"direction":"%s"}
            """.formatted(value, threshold, direction).strip();
        recordEvent(objectId, "THRESHOLD_BREACH", "WARNING",
            "Value " + value + " exceeded threshold " + threshold,
            details, "SYSTEM", metricPointId, tenantId);
    }
}
