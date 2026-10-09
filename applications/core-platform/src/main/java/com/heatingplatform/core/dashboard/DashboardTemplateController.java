package com.heatingplatform.core.dashboard;

import com.heatingplatform.core.dashboard.DashboardTemplate;
import com.heatingplatform.core.tenant.Tenant;
import com.heatingplatform.core.common.exception.ResourceNotFoundException;
import com.heatingplatform.core.common.exception.ValidationException;
import com.heatingplatform.core.dashboard.DashboardTemplateRepository;
import com.heatingplatform.core.tenant.TenantRepository;
import com.heatingplatform.core.user.AuthService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * REST API for tenant-scoped dashboard templates.
 *
 * <p>All endpoints require an authenticated user whose tenant context is resolved
 * via {@link AuthService#getAccessibleTenantIds()}.  Every read and write is
 * scoped to that tenant, enforcing row-level isolation without leaking data
 * across tenant boundaries.</p>
 *
 * <pre>
 *   GET    /api/v1/dashboard-templates       — list templates for tenant
 *   POST   /api/v1/dashboard-templates       — create a template
 *   DELETE /api/v1/dashboard-templates/{id}  — delete a template
 * </pre>
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/dashboard-templates")
@RequiredArgsConstructor
public class DashboardTemplateController {

    private final DashboardTemplateRepository dashboardTemplateRepository;
    private final TenantRepository tenantRepository;
    private final AuthService authService;

    // ─── List templates ───────────────────────────────────────────────────────

    /**
     * GET /api/v1/dashboard-templates
     *
     * <p>Returns all dashboard templates for the caller's tenant, ordered newest
     * first.</p>
     *
     * @return {@code { dashboardTemplates: [...] }}
     */
    @GetMapping
    public ResponseEntity<?> listTemplates() {
        log.info("GET /api/v1/dashboard-templates");

        UUID tenantId = resolveCurrentTenantId();

        if (tenantId == null && !authService.isConsultantOrAdmin()) {
            return ResponseEntity.status(403).body(Map.of("message", "Tenant context required"));
        }

        // Admins/consultants without a specific tenant see all templates
        List<DashboardTemplate> templates = (tenantId == null)
                ? dashboardTemplateRepository.findAllByOrderByCreatedAtDesc()
                : dashboardTemplateRepository.findByTenantIdOrderByCreatedAtDesc(tenantId);

        return ResponseEntity.ok(Map.of("dashboardTemplates", templates.stream()
                .map(this::toMap)
                .toList()));
    }

    // ─── Create template ──────────────────────────────────────────────────────

    /**
     * POST /api/v1/dashboard-templates
     *
     * <p>Expected body: {@code { name: string, layout: object, tenantId: string }}.
     * {@code tenantId} in the body is used when provided; otherwise the caller's
     * first accessible tenant is used. The caller must have access to the
     * resolved tenant.</p>
     *
     * @return 201 with the created template
     */
    @PostMapping
    public ResponseEntity<?> createTemplate(@RequestBody Map<String, Object> body) {
        log.info("POST /api/v1/dashboard-templates");

        UUID tenantId = resolveTenantIdFromBodyOrAuth(body);
        if (tenantId == null) {
            return ResponseEntity.badRequest().body(Map.of("message", "tenantId is required (provide in body or have tenant membership)"));
        }

        if (!authService.canAccessTenant(tenantId)) {
            return ResponseEntity.status(403).body(Map.of("message", "Access denied to tenant"));
        }

        String name = (String) body.get("name");
        if (name == null || name.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("message", "name is required"));
        }

        String layout = serializeLayout(body.get("layout"));
        if (layout == null) {
            return ResponseEntity.badRequest().body(Map.of("message", "Invalid layout JSON"));
        }

        Tenant tenant = tenantRepository.findById(tenantId)
                .orElseThrow(() -> new ResourceNotFoundException("Tenant", tenantId));

        DashboardTemplate template = new DashboardTemplate();
        template.setTenant(tenant);
        template.setName(name);
        template.setLayout(layout);
        template.setCreatedAt(Instant.now());

        DashboardTemplate saved = dashboardTemplateRepository.save(template);
        log.info("Created dashboard template {} for tenant {}", saved.getId(), tenantId);

        return ResponseEntity.status(201).body(Map.of("dashboardTemplate", toMap(saved)));
    }

    // ─── Delete template ──────────────────────────────────────────────────────

    /**
     * DELETE /api/v1/dashboard-templates/{id}
     *
     * <p>The caller must belong to the same tenant that owns the template.</p>
     *
     * @return 204 No Content on success
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<?> deleteTemplate(@PathVariable String id) {
        log.info("DELETE /api/v1/dashboard-templates/{}", id);

        UUID templateId = parseUUID(id, "template ID");

        DashboardTemplate template = dashboardTemplateRepository.findById(templateId)
                .orElseThrow(() -> new ResourceNotFoundException("DashboardTemplate", templateId));

        if (!authService.canAccessTenant(template.getTenant().getId())) {
            return ResponseEntity.status(403).body(Map.of("message", "Access denied to tenant"));
        }

        dashboardTemplateRepository.delete(template);
        log.info("Deleted dashboard template {}", templateId);

        return ResponseEntity.noContent().build();
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    /** Resolve the current user's primary tenant from the auth context. */
    private UUID resolveCurrentTenantId() {
        List<UUID> tenantIds = authService.getAccessibleTenantIds();
        return tenantIds.isEmpty() ? null : tenantIds.get(0);
    }

    /**
     * Prefer an explicit {@code tenantId} field in the request body; fall back
     * to the auth-context tenant so the frontend can be explicit without
     * requiring a separate lookup.
     */
    private UUID resolveTenantIdFromBodyOrAuth(Map<String, Object> body) {
        String tenantIdStr = (String) body.get("tenantId");
        if (tenantIdStr != null && !tenantIdStr.isBlank()) {
            return parseUUID(tenantIdStr, "tenantId");
        }
        return resolveCurrentTenantId();
    }

    /**
     * Accepts either a pre-serialised JSON string or an in-memory object/map
     * sent by Jackson, and always returns a JSON string suitable for JSONB
     * storage.  Returns {@code null} if serialisation fails.
     */
    private String serializeLayout(Object rawLayout) {
        if (rawLayout == null) {
            return "{}";
        }
        if (rawLayout instanceof String s) {
            return s;
        }
        if (rawLayout instanceof Map || rawLayout instanceof List) {
            try {
                return new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(rawLayout);
            } catch (Exception e) {
                log.warn("Failed to serialize layout: {}", e.getMessage());
                return null;
            }
        }
        return null;
    }

    private Map<String, Object> toMap(DashboardTemplate t) {
        return Map.of(
                "id",        t.getId().toString(),
                "tenantId",  t.getTenant().getId().toString(),
                "name",      t.getName(),
                "layout",    t.getLayout(),
                "createdAt", t.getCreatedAt() != null ? t.getCreatedAt().toString() : ""
        );
    }

    private UUID parseUUID(String value, String fieldName) {
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException e) {
            throw new ValidationException("Invalid " + fieldName + " format: " + value);
        }
    }
}
