package com.digitaldemon.core.device;

import com.digitaldemon.core.device.CapturedMessage;
import com.digitaldemon.core.device.DeviceDiscoveryService;
import com.digitaldemon.core.device.DiscoverySession;
import com.digitaldemon.core.user.AuthService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

/**
 * REST endpoints for MQTT device discovery.
 * Allows users to sniff live MQTT messages from a device
 * and analyze the payload structure for template creation.
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/device-discovery")
@RequiredArgsConstructor
@ConditionalOnProperty(name = "mqtt.discovery.enabled", havingValue = "true", matchIfMissing = true)
public class DeviceDiscoveryController {

    private final DeviceDiscoveryService discoveryService;
    private final AuthService authService;

    /**
     * POST /api/v1/device-discovery — Start a discovery session.
     * Body: { "deviceId": "shellyplus1pm-abc123", "tenantId": "..." (optional) }
     */
    @PostMapping
    public ResponseEntity<Map<String, Object>> startDiscovery(@RequestBody Map<String, Object> body) {
        log.info("REST POST /api/v1/device-discovery");

        if (!authService.isConsultantOrAdmin()) {
            return ResponseEntity.status(403).body(Map.of("message", "Consultant or admin role required"));
        }

        String deviceId = (String) body.get("deviceId");
        if (deviceId == null || deviceId.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("message", "'deviceId' is required"));
        }

        // Resolve tenant: explicit, first accessible, or synthetic for system admins
        UUID tenantId;
        String tenantIdStr = (String) body.get("tenantId");
        if (tenantIdStr != null && !tenantIdStr.isBlank()) {
            tenantId = UUID.fromString(tenantIdStr);
        } else {
            List<UUID> tenantIds = authService.getAccessibleTenantIds();
            if (!tenantIds.isEmpty()) {
                tenantId = tenantIds.get(0);
            } else if (authService.isSystemAdmin()) {
                // System admin with no tenant memberships — use a synthetic UUID for rate limiting
                tenantId = new UUID(0L, 0L);
            } else {
                return ResponseEntity.badRequest().body(Map.of("message", "No tenant context available"));
            }
        }

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
     * Optional `since` parameter enables incremental fetch (only messages after that timestamp).
     */
    @GetMapping("/{id}")
    public ResponseEntity<Map<String, Object>> getSession(
            @PathVariable String id,
            @RequestParam(required = false) Long since) {
        log.debug("REST GET /api/v1/device-discovery/{} (since={})", id, since);

        if (!authService.isConsultantOrAdmin()) {
            return ResponseEntity.status(403).body(Map.of("message", "Consultant or admin role required"));
        }

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

        if (!authService.isConsultantOrAdmin()) {
            return ResponseEntity.status(403).body(Map.of("message", "Consultant or admin role required"));
        }

        DiscoverySession session = discoveryService.getSession(UUID.fromString(id));
        if (session == null) {
            return ResponseEntity.notFound().build();
        }

        discoveryService.stopDiscovery(UUID.fromString(id));
        return ResponseEntity.ok(toSessionMap(session, null));
    }

    /**
     * POST /api/v1/device-discovery/{id}/analyze — Analyze captured payloads.
     * Returns discovered field structure and suggested signal map entries.
     */
    @PostMapping("/{id}/analyze")
    public ResponseEntity<Map<String, Object>> analyzePayloads(@PathVariable String id) {
        log.info("REST POST /api/v1/device-discovery/{}/analyze", id);

        if (!authService.isConsultantOrAdmin()) {
            return ResponseEntity.status(403).body(Map.of("message", "Consultant or admin role required"));
        }

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
