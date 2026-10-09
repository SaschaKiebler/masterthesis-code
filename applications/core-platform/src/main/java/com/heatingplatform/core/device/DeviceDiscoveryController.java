package com.heatingplatform.core.device;

import com.heatingplatform.core.tenancy.TenantBodyGuard;
import com.heatingplatform.core.user.AuthService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;

import java.util.List;
import java.util.Map;
import com.heatingplatform.core.tenancy.TenantUnscoped;

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
@TenantUnscoped(reason = "A discovery session id is a handle to transient state inside "
        + "device-management, not a row in this service's database, so the interceptor cannot "
        + "resolve a tenant from it. The handlers do it themselves: the session's tenant is "
        + "read back from device-management and checked with canAccessTenant before a session "
        + "is polled, stopped or analysed, a tenantId in the body must be one the caller "
        + "belongs to, and a device id already owned by another tenant cannot be tapped.")
public class DeviceDiscoveryController {

    private static final String FOREIGN = "Access denied to another tenant's resource";

    private final AuthService authService;
    private final TenantBodyGuard tenantBodyGuard;
    private final RestClient deviceManagement;

    public DeviceDiscoveryController(AuthService authService,
                                     TenantBodyGuard tenantBodyGuard,
                                     @Value("${device-management.url}") String deviceManagementUrl) {
        this.authService = authService;
        this.tenantBodyGuard = tenantBodyGuard;
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
            // The tenant keys the per-tenant session quota, so a foreign one
            // would let a caller exhaust another tenant's discovery slots.
            if (!authService.canAccessTenant(tenantId)) {
                return ResponseEntity.status(403).body(Map.of("message", FOREIGN));
            }
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

        // A tap on a device that already belongs to another tenant would hand
        // over its raw telemetry.
        tenantBodyGuard.requireDeviceNotForeign(deviceId);

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

        ResponseEntity<Map<String, Object>> denied = denyForeignSession(id);
        if (denied != null) {
            return denied;
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

        ResponseEntity<Map<String, Object>> denied = denyForeignSession(id);
        if (denied != null) {
            return denied;
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

        ResponseEntity<Map<String, Object>> denied = denyForeignSession(id);
        if (denied != null) {
            return denied;
        }

        return forward(() -> deviceManagement.post().uri("/api/v1/device-discovery/" + id + "/analyze"));
    }

    // ── Session ownership ─────────────────────────────────────────────────────

    /**
     * 403 when the session belongs to a tenant the caller cannot access, null
     * otherwise. The session's tenant is read back from device-management,
     * which is one extra round trip per call and the price of not keeping
     * session state in this service. An unknown session is left to the
     * forwarded call, which answers 404.
     */
    private ResponseEntity<Map<String, Object>> denyForeignSession(String id) {
        ResponseEntity<Map<String, Object>> session =
                forward(() -> deviceManagement.get().uri("/api/v1/device-discovery/" + id));
        if (!session.getStatusCode().is2xxSuccessful() || session.getBody() == null) {
            return null;
        }
        Object tenant = session.getBody().get("tenantId");
        if (tenant == null) {
            return null;
        }
        UUID tenantId;
        try {
            tenantId = UUID.fromString(tenant.toString());
        } catch (IllegalArgumentException e) {
            return null;
        }
        if (authService.canAccessTenant(tenantId)) {
            return null;
        }
        log.info("Denied cross-tenant access to discovery session {} of tenant {}", id, tenantId);
        return ResponseEntity.status(403).body(Map.of("message", FOREIGN));
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
