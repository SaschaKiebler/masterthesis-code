package com.heatingplatform.core.dashboard;

import com.heatingplatform.core.common.exception.ResourceNotFoundException;
import com.heatingplatform.core.common.exception.ValidationException;
import com.heatingplatform.core.dashboard.DashboardService.CreateDashboardRequest;
import com.heatingplatform.core.dashboard.DashboardService.DashboardDTO;
import com.heatingplatform.core.dashboard.DashboardService.UpdateDashboardRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * DashboardController — REST API for project dashboards (ADR-012 Phase 3).
 *
 * Endpoints:
 *   POST   /api/v1/projects/{id}/dashboards       — create dashboard
 *   GET    /api/v1/projects/{id}/dashboards       — list dashboards for project
 *   GET    /api/v1/dashboards/{id}                 — get dashboard with layout
 *   PATCH  /api/v1/dashboards/{id}                 — update dashboard (name, layout, scope)
 *   DELETE /api/v1/dashboards/{id}                 — delete dashboard
 */
@Slf4j
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class DashboardController {

    private final DashboardService dashboardService;

    // ─── List dashboards for project ──────────────────────────────────────────

    @GetMapping("/projects/{projectId}/dashboards")
    public ResponseEntity<?> listDashboards(@PathVariable String projectId) {
        log.info("GET /api/v1/projects/{}/dashboards", projectId);
        UUID pid = parseUUID(projectId, "project ID");

        try {
            List<DashboardDTO> dashboards = dashboardService.listDashboards(pid);
            return ResponseEntity.ok(Map.of("dashboards", dashboards));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        }
    }

    // ─── Create dashboard ─────────────────────────────────────────────────────

    @PostMapping("/projects/{projectId}/dashboards")
    public ResponseEntity<?> createDashboard(
            @PathVariable String projectId,
            @RequestBody Map<String, Object> body) {
        log.info("POST /api/v1/projects/{}/dashboards", projectId);
        UUID pid = parseUUID(projectId, "project ID");

        String name = (String) body.get("name");
        int sortOrder = body.containsKey("sortOrder") ? ((Number) body.get("sortOrder")).intValue() : 0;
        String scopeType = (String) body.get("scopeType");
        
        String scopeIdStr = (String) body.get("scopeId");
        UUID scopeId = null;
        if (scopeIdStr != null && !scopeIdStr.isBlank()) {
            scopeId = parseUUID(scopeIdStr, "scopeId");
        }
        
        String layout = null;
        if (body.get("layout") != null) {
            try {
                // If it's sent as an object/array, convert back to string
                if (body.get("layout") instanceof Map || body.get("layout") instanceof List) {
                    layout = new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(body.get("layout"));
                } else {
                    layout = (String) body.get("layout");
                }
            } catch (Exception e) {
                return ResponseEntity.badRequest().body(Map.of("message", "Invalid layout JSON"));
            }
        }

        try {
            DashboardDTO created = dashboardService.createDashboard(pid,
                new CreateDashboardRequest(name, sortOrder, scopeType, scopeId, layout));
            return ResponseEntity.status(201).body(Map.of("dashboard", created));
        } catch (ValidationException e) {
            return ResponseEntity.badRequest().body(Map.of("message", e.getMessage()));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        }
    }

    // ─── Get dashboard ────────────────────────────────────────────────────────

    @GetMapping("/dashboards/{id}")
    public ResponseEntity<?> getDashboard(@PathVariable String id) {
        log.info("GET /api/v1/dashboards/{}", id);
        UUID dashboardId = parseUUID(id, "dashboard ID");

        try {
            DashboardDTO dashboard = dashboardService.getDashboard(dashboardId);
            return ResponseEntity.ok(Map.of("dashboard", dashboard));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        }
    }

    // ─── Update dashboard ─────────────────────────────────────────────────────

    @PatchMapping("/dashboards/{id}")
    public ResponseEntity<?> updateDashboard(
            @PathVariable String id,
            @RequestBody Map<String, Object> body) {
        log.info("PATCH /api/v1/dashboards/{}", id);
        UUID dashboardId = parseUUID(id, "dashboard ID");

        String name = (String) body.get("name");
        Integer sortOrder = body.containsKey("sortOrder") ? ((Number) body.get("sortOrder")).intValue() : null;
        String scopeType = (String) body.get("scopeType");
        
        String scopeIdStr = (String) body.get("scopeId");
        UUID scopeId = null;
        if (scopeIdStr != null && !scopeIdStr.isBlank()) {
            scopeId = parseUUID(scopeIdStr, "scopeId");
        }
        
        String layout = null;
        if (body.get("layout") != null) {
            try {
                if (body.get("layout") instanceof Map || body.get("layout") instanceof List) {
                    layout = new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(body.get("layout"));
                } else {
                    layout = (String) body.get("layout");
                }
            } catch (Exception e) {
                return ResponseEntity.badRequest().body(Map.of("message", "Invalid layout JSON"));
            }
        }

        try {
            DashboardDTO updated = dashboardService.updateDashboard(dashboardId,
                new UpdateDashboardRequest(name, sortOrder, scopeType, scopeId, layout));
            return ResponseEntity.ok(Map.of("dashboard", updated));
        } catch (ValidationException e) {
            return ResponseEntity.badRequest().body(Map.of("message", e.getMessage()));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        }
    }

    // ─── Delete dashboard ─────────────────────────────────────────────────────

    @DeleteMapping("/dashboards/{id}")
    public ResponseEntity<?> deleteDashboard(@PathVariable String id) {
        log.info("DELETE /api/v1/dashboards/{}", id);
        UUID dashboardId = parseUUID(id, "dashboard ID");

        try {
            dashboardService.deleteDashboard(dashboardId);
            return ResponseEntity.noContent().build();
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        }
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    private UUID parseUUID(String value, String fieldName) {
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException e) {
            throw new ValidationException("Invalid " + fieldName + " format: " + value);
        }
    }
}
