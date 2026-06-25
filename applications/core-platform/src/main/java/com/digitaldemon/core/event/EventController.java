package com.digitaldemon.core.event;

import com.digitaldemon.core.ontology.ObjectEntity;
import com.digitaldemon.core.common.exception.ResourceNotFoundException;
import com.digitaldemon.core.common.exception.ValidationException;
import com.digitaldemon.core.ontology.ObjectRepository;
import com.digitaldemon.core.user.AuthService;
import com.digitaldemon.core.event.EventService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * EventController — REST API for operational event management (ADR-013).
 *
 * Endpoints:
 *   GET   /api/v1/objects/{objectId}/events   — paginated events for an object
 *   POST  /api/v1/objects/{objectId}/events   — record manual event (MAINTENANCE, etc.)
 *   GET   /api/v1/events                      — query events across tenant
 *   PATCH /api/v1/events/{id}/resolve         — mark event as resolved
 */
@Slf4j
@RestController
@RequiredArgsConstructor
public class EventController {

    private final EventService eventService;
    private final AuthService authService;
    private final ObjectRepository objectRepository;

    @GetMapping("/api/v1/objects/{objectId}/events")
    public ResponseEntity<?> getObjectEvents(@PathVariable String objectId,
                                              @RequestParam(required = false) String from,
                                              @RequestParam(required = false) String to,
                                              @RequestParam(defaultValue = "50") int limit,
                                              @RequestParam(defaultValue = "0") int offset) {
        log.info("GET /api/v1/objects/{}/events", objectId);
        UUID objId = parseUUID(objectId, "object ID");

        Instant fromTime = from != null ? Instant.parse(from) : null;
        Instant toTime = to != null ? Instant.parse(to) : null;

        List<?> events = eventService.getEventsForObject(objId, fromTime, toTime, limit, offset);
        return ResponseEntity.ok(Map.of("events", events, "count", events.size()));
    }

    @PostMapping("/api/v1/objects/{objectId}/events")
    public ResponseEntity<?> recordEvent(@PathVariable String objectId,
                                          @RequestBody Map<String, Object> body) {
        log.info("POST /api/v1/objects/{}/events", objectId);
        UUID objId = parseUUID(objectId, "object ID");
        UUID currentUserId = authService.getCurrentUser().map(u -> u.getId()).orElse(null);

        // Resolve tenant from the target object (handles SYSTEM_ADMIN who have no tenant list)
        ObjectEntity targetObject = objectRepository.findById(objId)
            .orElseThrow(() -> new ResourceNotFoundException("Object not found: " + objId));
        UUID tenantId = targetObject.getTenant() != null ? targetObject.getTenant().getId() : null;

        String eventType = (String) body.getOrDefault("eventType", "MAINTENANCE");
        String severity = (String) body.getOrDefault("severity", "INFO");
        String summary = (String) body.get("summary");
        String details = body.get("details") instanceof Map<?, ?> m
            ? mapToJson(m) : (String) body.getOrDefault("details", "{}");
        String timeStr = (String) body.get("time");

        if (summary == null || summary.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("message", "summary is required"));
        }

        Instant eventTime = null;
        if (timeStr != null && !timeStr.isBlank()) {
            eventTime = Instant.parse(timeStr);
            if (eventTime.isAfter(Instant.now().plusSeconds(60))) {
                return ResponseEntity.badRequest().body(Map.of("message", "Event time cannot be in the future"));
            }
        }

        eventService.recordEvent(objId, eventType, severity, summary, details, "USER",
            currentUserId, tenantId, eventTime);
        return ResponseEntity.status(201).body(Map.of("message", "Event recorded"));
    }

    @GetMapping("/api/v1/events")
    public ResponseEntity<?> queryEvents(@RequestParam(required = false) String from,
                                          @RequestParam(required = false) String to,
                                          @RequestParam(required = false) String eventTypes,
                                          @RequestParam(required = false) String severities,
                                          @RequestParam(defaultValue = "50") int limit,
                                          @RequestParam(defaultValue = "0") int offset) {
        log.info("GET /api/v1/events");
        List<UUID> tenantIds = authService.getAccessibleTenantIds();
        UUID tenantId = tenantIds.isEmpty() ? null : tenantIds.get(0);

        Instant fromTime = from != null ? Instant.parse(from) : null;
        Instant toTime = to != null ? Instant.parse(to) : null;
        List<String> typeFilter = eventTypes != null
            ? Arrays.asList(eventTypes.split(",")) : null;
        List<String> severityFilter = severities != null
            ? Arrays.asList(severities.split(",")) : null;

        List<?> events = eventService.queryEvents(tenantId, fromTime, toTime,
            typeFilter, severityFilter, limit, offset);
        return ResponseEntity.ok(Map.of("events", events, "count", events.size()));
    }

    @PatchMapping("/api/v1/events/{id}/resolve")
    public ResponseEntity<?> resolveEvent(@PathVariable String id,
                                           @RequestBody(required = false) Map<String, Object> body) {
        log.info("PATCH /api/v1/events/{}/resolve", id);
        UUID eventId = parseUUID(id, "event ID");
        UUID currentUserId = authService.getCurrentUser().map(u -> u.getId()).orElse(null);

        // For hypertable queries we need the time; client must provide it for efficiency
        String timeStr = body != null ? (String) body.get("time") : null;
        Instant eventTime = timeStr != null ? Instant.parse(timeStr) : Instant.now();
        String note = body != null ? (String) body.getOrDefault("note", "") : "";

        try {
            eventService.resolveEvent(eventId, eventTime, currentUserId, note);
            return ResponseEntity.ok(Map.of("message", "Event resolved"));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        }
    }

    private UUID parseUUID(String value, String fieldName) {
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException e) {
            throw new ValidationException("Invalid " + fieldName + ": " + value);
        }
    }

    @SuppressWarnings("unchecked")
    private String mapToJson(Map<?, ?> m) {
        StringBuilder sb = new StringBuilder("{");
        boolean first = true;
        for (Map.Entry<?, ?> e : m.entrySet()) {
            if (!first) sb.append(",");
            sb.append("\"").append(e.getKey()).append("\":\"").append(e.getValue()).append("\"");
            first = false;
        }
        sb.append("}");
        return sb.toString();
    }
}
