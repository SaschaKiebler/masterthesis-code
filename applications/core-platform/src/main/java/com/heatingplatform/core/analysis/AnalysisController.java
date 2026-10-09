package com.heatingplatform.core.analysis;

import com.heatingplatform.core.tenancy.TenantBodyGuard;
import com.heatingplatform.core.tenancy.ResourceKind;
import com.heatingplatform.core.common.exception.ResourceNotFoundException;
import com.heatingplatform.core.common.exception.ValidationException;
import com.heatingplatform.core.analysis.AnalysisViewService.AnalysisViewDTO;
import com.heatingplatform.core.analysis.AnalysisViewService.CreateAnalysisViewRequest;
import com.heatingplatform.core.analysis.AnalysisViewService.UpdateAnalysisViewRequest;
import com.heatingplatform.core.analysis.AnalysisTemplateService.AnalysisTemplateDTO;
import com.heatingplatform.core.analysis.AnalysisTemplateService.CreateAnalysisTemplateRequest;
import com.heatingplatform.core.analysis.AnalysisTemplateService.UpdateAnalysisTemplateRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * AnalysisController — REST API for analysis views and templates (Analysis Canvas).
 *
 * Analysis Views (project-scoped):
 *   POST   /api/v1/projects/{id}/analysis-views       — create view
 *   GET    /api/v1/projects/{id}/analysis-views       — list views for project
 *   GET    /api/v1/analysis-views/{id}                 — get view
 *   PATCH  /api/v1/analysis-views/{id}                 — update view
 *   DELETE /api/v1/analysis-views/{id}                 — delete view
 *
 * Analysis Templates (tenant-scoped + system):
 *   GET    /api/v1/analysis-templates                  — list templates
 *   GET    /api/v1/analysis-templates/{id}             — get template
 *   POST   /api/v1/analysis-templates                  — create template
 *   PATCH  /api/v1/analysis-templates/{id}             — update template
 *   DELETE /api/v1/analysis-templates/{id}             — delete template
 */
@Slf4j
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class AnalysisController {

    private final AnalysisViewService analysisViewService;
    private final AnalysisTemplateService analysisTemplateService;
    private final TenantBodyGuard tenantBodyGuard;

    // ─── Analysis Views ──────────────────────────────────────────────────────

    @GetMapping("/projects/{projectId}/analysis-views")
    public ResponseEntity<?> listViews(@PathVariable String projectId) {
        UUID pid = parseUUID(projectId, "project ID");
        try {
            List<AnalysisViewDTO> views = analysisViewService.listViews(pid);
            return ResponseEntity.ok(Map.of("analysisViews", views));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        }
    }

    @PostMapping("/projects/{projectId}/analysis-views")
    public ResponseEntity<?> createView(
            @PathVariable String projectId,
            @RequestBody Map<String, Object> body) {
        UUID pid = parseUUID(projectId, "project ID");
        String name = (String) body.get("name");
        String definition = extractJsonField(body, "definition");

        try {
            AnalysisViewDTO created = analysisViewService.createView(pid,
                new CreateAnalysisViewRequest(name, definition));
            return ResponseEntity.status(201).body(Map.of("analysisView", created));
        } catch (ValidationException e) {
            return ResponseEntity.badRequest().body(Map.of("message", e.getMessage()));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        }
    }

    @GetMapping("/analysis-views/{id}")
    public ResponseEntity<?> getView(@PathVariable String id) {
        UUID viewId = parseUUID(id, "analysis view ID");
        try {
            AnalysisViewDTO view = analysisViewService.getView(viewId);
            return ResponseEntity.ok(Map.of("analysisView", view));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        }
    }

    @PatchMapping("/analysis-views/{id}")
    public ResponseEntity<?> updateView(
            @PathVariable String id,
            @RequestBody Map<String, Object> body) {
        UUID viewId = parseUUID(id, "analysis view ID");
        String name = (String) body.get("name");
        String definition = extractJsonField(body, "definition");

        try {
            AnalysisViewDTO updated = analysisViewService.updateView(viewId,
                new UpdateAnalysisViewRequest(name, definition));
            return ResponseEntity.ok(Map.of("analysisView", updated));
        } catch (ValidationException e) {
            return ResponseEntity.badRequest().body(Map.of("message", e.getMessage()));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        }
    }

    @DeleteMapping("/analysis-views/{id}")
    public ResponseEntity<?> deleteView(@PathVariable String id) {
        UUID viewId = parseUUID(id, "analysis view ID");
        try {
            analysisViewService.deleteView(viewId);
            return ResponseEntity.noContent().build();
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        }
    }

    // ─── Analysis Templates ──────────────────────────────────────────────────

    @GetMapping("/analysis-templates")
    public ResponseEntity<?> listTemplates(@RequestParam(required = false) String tenantId) {
        UUID tid = null;
        if (tenantId != null && !tenantId.isBlank()) {
            tid = parseUUID(tenantId, "tenant ID");
        }
        List<AnalysisTemplateDTO> templates = analysisTemplateService.listTemplates(tid);
        return ResponseEntity.ok(Map.of("analysisTemplates", templates));
    }

    @GetMapping("/analysis-templates/{id}")
    public ResponseEntity<?> getTemplate(@PathVariable String id) {
        UUID templateId = parseUUID(id, "analysis template ID");
        try {
            AnalysisTemplateDTO template = analysisTemplateService.getTemplate(templateId);
            return ResponseEntity.ok(Map.of("analysisTemplate", template));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        }
    }

    @PostMapping("/analysis-templates")
    public ResponseEntity<?> createTemplate(@RequestBody Map<String, Object> body) {
        String name = (String) body.get("name");
        String description = (String) body.get("description");
        String category = (String) body.get("category");
        String definition = extractJsonField(body, "definition");

        String tenantIdStr = (String) body.get("tenantId");
        UUID tenantId = null;
        if (tenantIdStr != null && !tenantIdStr.isBlank()) {
            tenantId = parseUUID(tenantIdStr, "tenant ID");
        }
        // A tenant template needs membership, a system template (no tenant)
        // needs a system admin.
        tenantBodyGuard.requireTenantOrSystem(tenantId);

        try {
            AnalysisTemplateDTO created = analysisTemplateService.createTemplate(tenantId,
                new CreateAnalysisTemplateRequest(name, description, category, definition));
            return ResponseEntity.status(201).body(Map.of("analysisTemplate", created));
        } catch (ValidationException e) {
            return ResponseEntity.badRequest().body(Map.of("message", e.getMessage()));
        }
    }

    @PatchMapping("/analysis-templates/{id}")
    public ResponseEntity<?> updateTemplate(
            @PathVariable String id,
            @RequestBody Map<String, Object> body) {
        UUID templateId = parseUUID(id, "analysis template ID");
        String name = (String) body.get("name");
        String description = (String) body.get("description");
        String category = (String) body.get("category");
        String definition = extractJsonField(body, "definition");

        try {
            AnalysisTemplateDTO updated = analysisTemplateService.updateTemplate(templateId,
                new UpdateAnalysisTemplateRequest(name, description, category, definition));
            return ResponseEntity.ok(Map.of("analysisTemplate", updated));
        } catch (ValidationException e) {
            return ResponseEntity.badRequest().body(Map.of("message", e.getMessage()));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        }
    }

    @DeleteMapping("/analysis-templates/{id}")
    public ResponseEntity<?> deleteTemplate(@PathVariable String id) {
        UUID templateId = parseUUID(id, "analysis template ID");
        try {
            analysisTemplateService.deleteTemplate(templateId);
            return ResponseEntity.noContent().build();
        } catch (ValidationException e) {
            return ResponseEntity.badRequest().body(Map.of("message", e.getMessage()));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        }
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    private UUID parseUUID(String value, String fieldName) {
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException e) {
            throw new ValidationException("Invalid " + fieldName + " format: " + value);
        }
    }

    private String extractJsonField(Map<String, Object> body, String field) {
        Object value = body.get(field);
        if (value == null) return null;
        if (value instanceof String s) return s;
        try {
            return new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(value);
        } catch (Exception e) {
            throw new ValidationException("Invalid " + field + " JSON");
        }
    }
}
