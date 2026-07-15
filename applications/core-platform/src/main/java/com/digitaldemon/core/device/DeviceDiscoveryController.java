package com.digitaldemon.core.device;

import com.digitaldemon.core.user.AuthService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Proxy for MQTT discovery sessions, which live in the device-management
 * service (the only service holding a broker connection). Core keeps the
 * public API surface and enforces authentication and tenant resolution,
 * then forwards to device-management unchanged, so the frontend contract
 * is identical to the pre-extraction endpoints.
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/device-discovery")
public class DeviceDiscoveryController {

    private final AuthService authService;
    private final RestClient deviceManagement;

    public DeviceDiscoveryController(AuthService authService,
                                     @Value("${device-management.url}") String deviceManagementUrl) {
        this.authService = authService;
        this.deviceManagement = RestClient.builder().baseUrl(deviceManagementUrl).build();
    }

    /**
     * POST /api/v1/device-discovery — Start a discovery session.
     * Body: { "deviceId": "shellyplus1pm-abc123", "tenantId": "..." (optional) }
     */
    @PostMapping
    public ResponseEntity<Map<String, Object>> startDiscovery(@RequestBody Map<String, Object> body) {
        log.info("REST POST /api/v1/device-discovery (proxy)");

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
                // System admin with no tenant memberships — synthetic UUID for rate limiting
                tenantId = new UUID(0L, 0L);
            } else {
                return ResponseEntity.badRequest().body(Map.of("message", "No tenant context available"));
            }
        }

        return forward(() -> deviceManagement.post()
                .uri("/api/v1/device-discovery")
                .contentType(MediaType.APPLICATION_JSON)
                .body(Map.of("deviceId", deviceId.trim(), "tenantId", tenantId.toString())));
    }

    /**
     * GET /api/v1/device-discovery/{id}?since={epochMs} — Poll for messages.
     */
    @GetMapping("/{id}")
    public ResponseEntity<Map<String, Object>> getSession(
            @PathVariable String id,
            @RequestParam(required = false) Long since) {

        if (!authService.isConsultantOrAdmin()) {
            return ResponseEntity.status(403).body(Map.of("message", "Consultant or admin role required"));
        }

        String uri = since != null
                ? "/api/v1/device-discovery/" + id + "?since=" + since
                : "/api/v1/device-discovery/" + id;
        return forward(() -> deviceManagement.get().uri(uri));
    }

    /**
     * DELETE /api/v1/device-discovery/{id} — Stop a discovery session.
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String, Object>> stopDiscovery(@PathVariable String id) {
        log.info("REST DELETE /api/v1/device-discovery/{} (proxy)", id);

        if (!authService.isConsultantOrAdmin()) {
            return ResponseEntity.status(403).body(Map.of("message", "Consultant or admin role required"));
        }

        return forward(() -> deviceManagement.delete().uri("/api/v1/device-discovery/" + id));
    }

    /**
     * POST /api/v1/device-discovery/{id}/analyze — Analyze captured payloads.
     */
    @PostMapping("/{id}/analyze")
    public ResponseEntity<Map<String, Object>> analyzePayloads(@PathVariable String id) {
        log.info("REST POST /api/v1/device-discovery/{}/analyze (proxy)", id);

        if (!authService.isConsultantOrAdmin()) {
            return ResponseEntity.status(403).body(Map.of("message", "Consultant or admin role required"));
        }

        return forward(() -> deviceManagement.post().uri("/api/v1/device-discovery/" + id + "/analyze"));
    }

    // ── Forwarding ────────────────────────────────────────────────────────────

    @SuppressWarnings("unchecked")
    private ResponseEntity<Map<String, Object>> forward(
            java.util.function.Supplier<RestClient.RequestHeadersSpec<?>> request) {
        try {
            return request.get().exchange((req, res) -> {
                Map<String, Object> responseBody = res.bodyTo(Map.class);
                return ResponseEntity.status(res.getStatusCode()).body(responseBody);
            });
        } catch (ResourceAccessException e) {
            log.error("device-management unreachable: {}", e.getMessage());
            return ResponseEntity.status(503)
                    .body(Map.of("message", "Device-management service is unavailable"));
        }
    }
}
