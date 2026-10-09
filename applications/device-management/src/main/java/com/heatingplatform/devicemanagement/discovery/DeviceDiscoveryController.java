package com.heatingplatform.devicemanagement.discovery;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

/**
 * REST endpoints for MQTT discovery sessions. The API shape matches the
 * former core-platform endpoints one to one; core-platform proxies these
 * paths and enforces authentication and roles before forwarding. This
 * service itself is internal and unauthenticated.
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/device-discovery")
@RequiredArgsConstructor
@ConditionalOnProperty(name = "device-management.discovery.enabled", havingValue = "true", matchIfMissing = true)
public class DeviceDiscoveryController {

    private final DeviceDiscoveryService discoveryService;

    /**
     * POST /api/v1/device-discovery — Start a discovery session.
     * Body: { "deviceId": "shellyplus1pm-abc123", "tenantId": "..." }
     */
    @PostMapping
    public ResponseEntity<Map<String, Object>> startDiscovery(@RequestBody Map<String, Object> body) {
        log.info("REST POST /api/v1/device-discovery");

        String deviceId = (String) body.get("deviceId");
        if (deviceId == null || deviceId.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("message", "'deviceId' is required"));
        }

        String tenantIdStr = (String) body.get("tenantId");
        UUID tenantId = tenantIdStr != null && !tenantIdStr.isBlank()
                ? UUID.fromString(tenantIdStr)
                : new UUID(0L, 0L);

        try {
            DiscoverySession session = discoveryService.startDiscovery(deviceId.trim(), tenantId);
            return ResponseEntity.status(201).body(toSessionMap(session, null));
        } catch (IllegalStateException e) {
            return ResponseEntity.status(429).body(Map.of("message", e.getMessage()));
        } catch (RuntimeException e) {
            return ResponseEntity.internalServerError().body(Map.of("message", e.getMessage()));
        }
    }

    /**
     * GET /api/v1/device-discovery/{id}?since={epochMs} — Poll for messages.
     */
    @GetMapping("/{id}")
    public ResponseEntity<Map<String, Object>> getSession(
            @PathVariable String id,
            @RequestParam(required = false) Long since) {
        log.debug("REST GET /api/v1/device-discovery/{} (since={})", id, since);

        DiscoverySession session = discoveryService.getSession(UUID.fromString(id));
        if (session == null) {
            return ResponseEntity.notFound().build();
        }

        Instant sinceInstant = since != null ? Instant.ofEpochMilli(since) : null;
        return ResponseEntity.ok(toSessionMap(session, sinceInstant));
    }

    /**
     * DELETE /api/v1/device-discovery/{id} — Stop a discovery session.
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String, Object>> stopDiscovery(@PathVariable String id) {
        log.info("REST DELETE /api/v1/device-discovery/{}", id);

        DiscoverySession session = discoveryService.getSession(UUID.fromString(id));
        if (session == null) {
            return ResponseEntity.notFound().build();
        }

        discoveryService.stopDiscovery(UUID.fromString(id));
        return ResponseEntity.ok(toSessionMap(session, null));
    }

    /**
     * POST /api/v1/device-discovery/{id}/analyze — Analyze captured payloads.
     */
    @PostMapping("/{id}/analyze")
    public ResponseEntity<Map<String, Object>> analyzePayloads(@PathVariable String id) {
        log.info("REST POST /api/v1/device-discovery/{}/analyze", id);

        DiscoverySession session = discoveryService.getSession(UUID.fromString(id));
        if (session == null) {
            return ResponseEntity.notFound().build();
        }

        Map<String, Object> analysis = discoveryService.analyzePayloads(UUID.fromString(id));
        return ResponseEntity.ok(analysis);
    }

    // ── Mappers ───────────────────────────────────────────────────────────────

    private Map<String, Object> toSessionMap(DiscoverySession session, Instant since) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("sessionId", session.getSessionId().toString());
        map.put("deviceId", session.getDeviceId());
        map.put("tenantId", session.getTenantId().toString());
        map.put("status", session.getStatus().name());
        map.put("messageCount", session.getMessageCount());
        map.put("uniqueTopicCount", session.getUniqueTopicCount());
        map.put("startedAt", session.getStartedAt().toEpochMilli());
        map.put("stoppedAt", session.getStoppedAt() != null ? session.getStoppedAt().toEpochMilli() : null);

        List<CapturedMessage> messages = session.getMessageList();
        if (since != null) {
            messages = messages.stream()
                    .filter(m -> m.getTimestamp().isAfter(since))
                    .collect(Collectors.toList());
        }

        List<Map<String, Object>> messageMaps = messages.stream()
                .map(this::toMessageMap)
                .collect(Collectors.toList());
        map.put("messages", messageMaps);

        return map;
    }

    private Map<String, Object> toMessageMap(CapturedMessage msg) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("topic", msg.getTopic());
        map.put("rawPayload", msg.getRawPayload());
        map.put("parsedPayload", msg.getParsedPayload());
        map.put("timestamp", msg.getTimestamp().toEpochMilli());
        return map;
    }
}
