package com.digitaldemon.core.event;

import com.digitaldemon.core.event.EventTemplate;
import com.digitaldemon.core.user.AuthService;
import com.digitaldemon.core.event.EventTemplateService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@Slf4j
@RestController
@RequestMapping("/api/v1/event-templates")
@RequiredArgsConstructor
public class EventTemplateController {

    private final EventTemplateService templateService;
    private final AuthService authService;

    @GetMapping
    public ResponseEntity<?> listTemplates() {
        log.info("GET /api/v1/event-templates");
        UUID tenantId = getFirstTenantId();
        List<EventTemplate> templates = templateService.getTemplatesForTenant(tenantId);
        return ResponseEntity.ok(templates);
    }

    @PostMapping
    public ResponseEntity<?> createTemplate(@RequestBody Map<String, Object> body) {
        log.info("POST /api/v1/event-templates");
        UUID tenantId = getFirstTenantId();
        if (tenantId == null) {
            return ResponseEntity.badRequest().body(Map.of("message", "Tenant context required"));
        }

        String label = (String) body.get("label");
        String eventType = (String) body.get("eventType");
        String severity = (String) body.getOrDefault("severity", "INFO");
        String summary = (String) body.get("summary");
        int sortOrder = body.get("sortOrder") instanceof Number n ? n.intValue() : 0;

        if (label == null || label.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("message", "label is required"));
        }
        if (eventType == null || eventType.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("message", "eventType is required"));
        }
        if (summary == null || summary.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("message", "summary is required"));
        }

        EventTemplate template = templateService.createTemplate(tenantId, label, eventType,
            severity, summary, sortOrder);
        return ResponseEntity.status(201).body(template);
    }

    @PutMapping("/{id}")
    public ResponseEntity<?> updateTemplate(@PathVariable String id,
                                             @RequestBody Map<String, Object> body) {
        log.info("PUT /api/v1/event-templates/{}", id);
        UUID templateId;
        try {
            templateId = UUID.fromString(id);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("message", "Invalid template ID"));
        }

        String label = (String) body.get("label");
        String eventType = (String) body.get("eventType");
        String severity = (String) body.get("severity");
        String summary = (String) body.get("summary");
        Integer sortOrder = body.get("sortOrder") instanceof Number n ? n.intValue() : null;

        try {
            EventTemplate template = templateService.updateTemplate(templateId, label, eventType,
                severity, summary, sortOrder);
            return ResponseEntity.ok(template);
        } catch (com.digitaldemon.core.common.exception.ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        } catch (IllegalStateException e) {
            return ResponseEntity.status(403).body(Map.of("message", e.getMessage()));
        }
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> deleteTemplate(@PathVariable String id) {
        log.info("DELETE /api/v1/event-templates/{}", id);
        UUID templateId;
        try {
            templateId = UUID.fromString(id);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("message", "Invalid template ID"));
        }

        try {
            templateService.deleteTemplate(templateId);
            return ResponseEntity.ok(Map.of("message", "Template deleted"));
        } catch (com.digitaldemon.core.common.exception.ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        } catch (IllegalStateException e) {
            return ResponseEntity.status(403).body(Map.of("message", e.getMessage()));
        }
    }

    private UUID getFirstTenantId() {
        List<UUID> tenantIds = authService.getAccessibleTenantIds();
        return tenantIds.isEmpty() ? null : tenantIds.get(0);
    }
}
