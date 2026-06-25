package com.digitaldemon.core.ontology;

import com.digitaldemon.core.kpiformula.KpiFormulaAiProperties;
import com.digitaldemon.core.device.DeviceTemplate;
import com.digitaldemon.core.ontology.ObjectType;
import com.digitaldemon.core.tenant.Tenant;
import com.digitaldemon.core.common.exception.ResourceNotFoundException;
import com.digitaldemon.core.common.exception.ValidationException;
import com.digitaldemon.core.device.DeviceTemplateRepository;
import com.digitaldemon.core.ontology.ObjectTypeRepository;
import com.digitaldemon.core.tenant.TenantRepository;
import com.digitaldemon.core.user.AuthService;
import com.digitaldemon.core.ontology.SvgGenerationService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

/**
 * REST endpoints for the Ontology Registry (ADR-007).
 * Provides CRUD for object types and device templates.
 * These are direct DB operations — no gRPC layer needed.
 */
@Slf4j
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class RegistryController {

    private static final ObjectMapper objectMapper = new ObjectMapper();

    @Value("${template-builder.n8n.webhook-url:}")
    private String templateWebhookUrl;

    @Value("${template-builder.n8n.timeout-seconds:120}")
    private int templateWebhookTimeoutSeconds;

    private static final HttpClient HTTP_CLIENT = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    private final KpiFormulaAiProperties kpiFormulaAiProperties;
    private final ObjectTypeRepository objectTypeRepository;
    private final DeviceTemplateRepository deviceTemplateRepository;
    private final TenantRepository tenantRepository;
    private final AuthService authService;
    private final SvgGenerationService svgGenerationService;

    // ── Object Types ──────────────────────────────────────────────────────────
    
    @GetMapping("/object-types")
    public ResponseEntity<Map<String, Object>> listObjectTypes() {
        log.info("REST GET /api/v1/object-types");
        
        List<ObjectType> types = objectTypeRepository.findAllActiveSystemDefaults();
        
        List<Map<String, Object>> result = types.stream()
            .map(this::toObjectTypeMap)
            .collect(Collectors.toList());
        
        return ResponseEntity.ok(Map.of("objectTypes", result));
    }
    
    @GetMapping("/object-types/{id}")
    public ResponseEntity<Map<String, Object>> getObjectType(@PathVariable String id) {
        log.info("REST GET /api/v1/object-types/{}", id);
        
        return objectTypeRepository.findById(UUID.fromString(id))
            .filter(ObjectType::getActive)
            .map(ot -> ResponseEntity.ok(Map.of("objectType", (Object) toObjectTypeMap(ot))))
            .orElse(ResponseEntity.notFound().build());
    }
    
    /**
     * POST /api/v1/object-types — Create a system object type.
     * System admin only.
     */
    @PostMapping("/object-types")
    public ResponseEntity<Map<String, Object>> createObjectType(@RequestBody Map<String, Object> body) {
        log.info("REST POST /api/v1/object-types");

        if (!authService.isSystemAdmin()) {
            return ResponseEntity.status(403).body(Map.of("message", "System admin role required"));
        }

        String name = (String) body.get("name");
        String displayName = (String) body.get("displayName");
        String category = (String) body.get("category");
        if (name == null || name.isBlank() || displayName == null || displayName.isBlank() || category == null || category.isBlank()) {
            throw new ValidationException("name, displayName, and category are required");
        }

        ObjectType ot = new ObjectType();
        ot.setName(name);
        ot.setDisplayName(displayName);
        ot.setCategory(category);
        ot.setDescription((String) body.get("description"));
        ot.setIcon((String) body.get("icon"));
        ot.setPropertySchema((String) body.get("propertySchema"));
        ot.setSortOrder(body.containsKey("sortOrder") ? ((Number) body.get("sortOrder")).intValue() : 0);
        ot.setActive(true);
        ot.setCreatedAt(Instant.now());
        ot.setUpdatedAt(Instant.now());

        ObjectType saved = objectTypeRepository.save(ot);
        log.info("Created object type: {} (id: {})", saved.getName(), saved.getId());

        return ResponseEntity.status(201).body(Map.of("objectType", toObjectTypeMap(saved)));
    }

    /**
     * PATCH /api/v1/object-types/{id} — Update an object type.
     * System admin only.
     */
    @PatchMapping("/object-types/{id}")
    public ResponseEntity<Map<String, Object>> updateObjectType(
            @PathVariable String id,
            @RequestBody Map<String, Object> body) {
        log.info("REST PATCH /api/v1/object-types/{}", id);

        if (!authService.isSystemAdmin()) {
            return ResponseEntity.status(403).body(Map.of("message", "System admin role required"));
        }

        ObjectType ot = objectTypeRepository.findById(UUID.fromString(id))
                .orElseThrow(() -> new ResourceNotFoundException("ObjectType", UUID.fromString(id)));

        if (body.containsKey("displayName")) ot.setDisplayName((String) body.get("displayName"));
        if (body.containsKey("category")) ot.setCategory((String) body.get("category"));
        if (body.containsKey("description")) ot.setDescription((String) body.get("description"));
        if (body.containsKey("icon")) ot.setIcon((String) body.get("icon"));
        if (body.containsKey("propertySchema")) ot.setPropertySchema((String) body.get("propertySchema"));
        if (body.containsKey("sortOrder")) ot.setSortOrder(((Number) body.get("sortOrder")).intValue());
        ot.setUpdatedAt(Instant.now());

        ObjectType saved = objectTypeRepository.save(ot);
        return ResponseEntity.ok(Map.of("objectType", toObjectTypeMap(saved)));
    }

    /**
     * DELETE /api/v1/object-types/{id} — Soft-delete an object type.
     * System admin only.
     */
    @DeleteMapping("/object-types/{id}")
    public ResponseEntity<Map<String, Object>> deleteObjectType(@PathVariable String id) {
        log.info("REST DELETE /api/v1/object-types/{}", id);

        if (!authService.isSystemAdmin()) {
            return ResponseEntity.status(403).body(Map.of("message", "System admin role required"));
        }

        ObjectType ot = objectTypeRepository.findById(UUID.fromString(id))
                .orElseThrow(() -> new ResourceNotFoundException("ObjectType", UUID.fromString(id)));

        ot.setActive(false);
        ot.setUpdatedAt(Instant.now());
        objectTypeRepository.save(ot);

        log.info("Soft-deleted object type: {} (id: {})", ot.getName(), ot.getId());
        return ResponseEntity.ok(Map.of("message", "Object type deleted"));
    }

    /**
     * POST /api/v1/object-types/{id}/generate-svg — Generate a P&ID-style SVG icon via AI.
     * Calls n8n webhook, uploads to GCS, saves URL on the ObjectType.
     *
     * Tenant scoping:
     * - System default types (tenant_id IS NULL): only system admins can regenerate
     * - Tenant-specific types: only users of that tenant can generate
     */
    @PostMapping("/object-types/{id}/generate-svg")
    public ResponseEntity<Map<String, Object>> generateSvgIcon(@PathVariable String id) {
        log.info("REST POST /api/v1/object-types/{}/generate-svg", id);

        try {
            UUID objectTypeId = UUID.fromString(id);

            // Check tenant access
            ObjectType ot = objectTypeRepository.findById(objectTypeId)
                .orElseThrow(() -> new ResourceNotFoundException("ObjectType", objectTypeId));

            if (ot.getTenant() == null) {
                // System default type — only system admins
                if (!authService.isSystemAdmin()) {
                    return ResponseEntity.status(403)
                        .body(Map.of("message", "Only system admins can modify system default icons"));
                }
            } else {
                // Tenant-specific type — check caller belongs to this tenant
                List<UUID> accessibleTenants = authService.getAccessibleTenantIds();
                if (!accessibleTenants.isEmpty() && !accessibleTenants.contains(ot.getTenant().getId())) {
                    return ResponseEntity.status(403)
                        .body(Map.of("message", "You do not have access to this tenant's object types"));
                }
            }

            SvgGenerationService.SvgGenerationResult result = svgGenerationService.generate(objectTypeId);
            return ResponseEntity.ok(Map.of(
                "svgIconUrl", result.svgIconUrl(),
                "objectTypeName", result.objectTypeName()
            ));
        } catch (IllegalStateException e) {
            return ResponseEntity.status(503).body(Map.of("message", e.getMessage()));
        } catch (IllegalArgumentException | ResourceNotFoundException e) {
            return ResponseEntity.badRequest().body(Map.of("message", e.getMessage()));
        } catch (Exception e) {
            log.error("SVG generation failed for object type {}: {}", id, e.getMessage(), e);
            return ResponseEntity.status(500).body(Map.of("message", "SVG generation failed: " + e.getMessage()));
        }
    }

    // ── Device Templates ──────────────────────────────────────────────────────
    
    @GetMapping("/device-templates")
    public ResponseEntity<Map<String, Object>> listDeviceTemplates(
            @RequestParam(required = false) String protocol) {
        log.info("REST GET /api/v1/device-templates (protocol={})", protocol);

        // Collect templates: system defaults + tenant-scoped for accessible tenants
        List<DeviceTemplate> templates;
        List<UUID> tenantIds = authService.getAccessibleTenantIds();

        if (!tenantIds.isEmpty()) {
            // Merge system defaults + tenant-scoped templates for each accessible tenant
            Set<UUID> seen = new HashSet<>();
            List<DeviceTemplate> merged = new ArrayList<>();
            for (UUID tid : tenantIds) {
                for (DeviceTemplate dt : deviceTemplateRepository.findAllActiveByTenant(tid)) {
                    if (seen.add(dt.getId())) merged.add(dt);
                }
            }
            // Also add system defaults not yet included
            for (DeviceTemplate dt : deviceTemplateRepository.findAllActiveSystemDefaults()) {
                if (seen.add(dt.getId())) merged.add(dt);
            }
            templates = merged;
        } else {
            templates = deviceTemplateRepository.findAllActiveSystemDefaults();
        }

        // Apply protocol filter if provided
        if (protocol != null && !protocol.isBlank()) {
            String proto = protocol.toUpperCase();
            templates = templates.stream()
                .filter(dt -> proto.equalsIgnoreCase(dt.getProtocol()))
                .collect(Collectors.toList());
        }

        List<Map<String, Object>> result = templates.stream()
            .map(this::toDeviceTemplateMap)
            .collect(Collectors.toList());

        return ResponseEntity.ok(Map.of("deviceTemplates", result));
    }
    
    @GetMapping("/device-templates/{id}")
    public ResponseEntity<Map<String, Object>> getDeviceTemplate(@PathVariable String id) {
        log.info("REST GET /api/v1/device-templates/{}", id);
        
        return deviceTemplateRepository.findById(UUID.fromString(id))
            .filter(DeviceTemplate::getActive)
            .map(dt -> ResponseEntity.ok(Map.of("deviceTemplate", (Object) toDeviceTemplateMap(dt))))
            .orElse(ResponseEntity.notFound().build());
    }
    
    /**
     * POST /api/v1/device-templates — Create a device template.
     * System admin for system-wide, consultant/manager for tenant-scoped.
     * If no tenantId is provided and user is a consultant, auto-resolves to first accessible tenant.
     */
    @PostMapping("/device-templates")
    public ResponseEntity<Map<String, Object>> createDeviceTemplate(@RequestBody Map<String, Object> body) {
        log.info("REST POST /api/v1/device-templates");

        String tenantIdStr = (String) body.get("tenantId");
        Tenant tenant = null;

        if (tenantIdStr != null && !tenantIdStr.isBlank()) {
            UUID tenantId = UUID.fromString(tenantIdStr);
            if (!authService.isManagerInTenant(tenantId)) {
                return ResponseEntity.status(403).body(Map.of("message", "Manager role required in tenant"));
            }
            tenant = tenantRepository.findById(tenantId)
                    .orElseThrow(() -> new ResourceNotFoundException("Tenant", tenantId));
        } else if (authService.isConsultantOrAdmin()) {
            // Consultant without explicit tenantId — auto-resolve to first accessible tenant
            List<UUID> tenantIds = authService.getAccessibleTenantIds();
            if (!tenantIds.isEmpty()) {
                UUID tenantId = tenantIds.get(0);
                tenant = tenantRepository.findById(tenantId)
                        .orElseThrow(() -> new ResourceNotFoundException("Tenant", tenantId));
            } else if (!authService.isSystemAdmin()) {
                return ResponseEntity.badRequest().body(Map.of("message", "No tenant context available. Create a project first."));
            }
            // System admin with no tenantIds → creates system-wide template (tenant stays null)
        } else {
            return ResponseEntity.status(403).body(Map.of("message", "Consultant or manager role required"));
        }

        String name = (String) body.get("name");
        if (name == null || name.isBlank()) {
            throw new ValidationException("name is required");
        }

        DeviceTemplate dt = new DeviceTemplate();
        dt.setTenant(tenant);
        dt.setName(name);
        dt.setManufacturer((String) body.get("manufacturer"));
        dt.setModelNumber((String) body.get("modelNumber"));
        dt.setDescription((String) body.get("description"));
        dt.setProtocol((String) body.get("protocol"));
        dt.setDefaultSignalMap(toJsonString(body.get("defaultSignalMap")));
        dt.setDefaultSpecs(toJsonString(body.get("defaultSpecs")));
        dt.setSecretsSchema(toJsonString(body.get("secretsSchema")));
        log.debug("Device template JSONB fields — signalMap: {}, specs: {}, secrets: {}",
                dt.getDefaultSignalMap() != null ? dt.getDefaultSignalMap().length() + " chars" : "null",
                dt.getDefaultSpecs() != null ? dt.getDefaultSpecs().length() + " chars" : "null",
                dt.getSecretsSchema() != null ? dt.getSecretsSchema().length() + " chars" : "null");
        dt.setSortOrder(body.containsKey("sortOrder") ? ((Number) body.get("sortOrder")).intValue() : 0);
        dt.setActive(true);
        dt.setCreatedAt(Instant.now());
        dt.setUpdatedAt(Instant.now());

        // Link to object type if provided
        String objectTypeIdStr = (String) body.get("objectTypeId");
        if (objectTypeIdStr != null && !objectTypeIdStr.isBlank()) {
            ObjectType ot = objectTypeRepository.findById(UUID.fromString(objectTypeIdStr))
                    .orElseThrow(() -> new ResourceNotFoundException("ObjectType", UUID.fromString(objectTypeIdStr)));
            dt.setObjectType(ot);
        }

        DeviceTemplate saved = deviceTemplateRepository.save(dt);
        log.info("Created device template: {} (id: {})", saved.getName(), saved.getId());

        return ResponseEntity.status(201).body(Map.of("deviceTemplate", toDeviceTemplateMap(saved)));
    }

    /**
     * PATCH /api/v1/device-templates/{id} — Update a device template.
     * Consultant/manager for tenant-scoped, system admin for system-wide.
     */
    @PatchMapping("/device-templates/{id}")
    public ResponseEntity<Map<String, Object>> updateDeviceTemplate(
            @PathVariable String id,
            @RequestBody Map<String, Object> body) {
        log.info("REST PATCH /api/v1/device-templates/{}", id);

        DeviceTemplate dt = deviceTemplateRepository.findById(UUID.fromString(id))
                .orElseThrow(() -> new ResourceNotFoundException("DeviceTemplate", UUID.fromString(id)));

        // Auth: consultant/manager for tenant-scoped, system admin for system-wide
        if (dt.getTenant() != null) {
            if (!authService.isManagerInTenant(dt.getTenant().getId())) {
                return ResponseEntity.status(403).body(Map.of("message", "Manager role required in tenant"));
            }
        } else {
            if (!authService.isSystemAdmin()) {
                return ResponseEntity.status(403).body(Map.of("message", "System admin required for system-wide templates"));
            }
        }

        if (body.containsKey("name")) dt.setName((String) body.get("name"));
        if (body.containsKey("manufacturer")) dt.setManufacturer((String) body.get("manufacturer"));
        if (body.containsKey("modelNumber")) dt.setModelNumber((String) body.get("modelNumber"));
        if (body.containsKey("description")) dt.setDescription((String) body.get("description"));
        if (body.containsKey("protocol")) dt.setProtocol((String) body.get("protocol"));
        if (body.containsKey("defaultSignalMap")) dt.setDefaultSignalMap(toJsonString(body.get("defaultSignalMap")));
        if (body.containsKey("defaultSpecs")) dt.setDefaultSpecs(toJsonString(body.get("defaultSpecs")));
        if (body.containsKey("secretsSchema")) dt.setSecretsSchema(toJsonString(body.get("secretsSchema")));
        log.debug("Device template PATCH JSONB fields — signalMap: {}, specs: {}, secrets: {}",
                dt.getDefaultSignalMap() != null ? dt.getDefaultSignalMap().length() + " chars" : "null",
                dt.getDefaultSpecs() != null ? dt.getDefaultSpecs().length() + " chars" : "null",
                dt.getSecretsSchema() != null ? dt.getSecretsSchema().length() + " chars" : "null");
        if (body.containsKey("objectTypeId")) {
            String objectTypeIdStr = (String) body.get("objectTypeId");
            if (objectTypeIdStr != null && !objectTypeIdStr.isBlank()) {
                ObjectType ot = objectTypeRepository.findById(UUID.fromString(objectTypeIdStr))
                        .orElseThrow(() -> new ResourceNotFoundException("ObjectType", UUID.fromString(objectTypeIdStr)));
                dt.setObjectType(ot);
            } else {
                dt.setObjectType(null);
            }
        }
        if (body.containsKey("sortOrder")) dt.setSortOrder(((Number) body.get("sortOrder")).intValue());
        dt.setUpdatedAt(Instant.now());

        DeviceTemplate saved = deviceTemplateRepository.save(dt);
        return ResponseEntity.ok(Map.of("deviceTemplate", toDeviceTemplateMap(saved)));
    }

    /**
     * DELETE /api/v1/device-templates/{id} — Soft-delete a device template.
     */
    @DeleteMapping("/device-templates/{id}")
    public ResponseEntity<Map<String, Object>> deleteDeviceTemplate(@PathVariable String id) {
        log.info("REST DELETE /api/v1/device-templates/{}", id);

        DeviceTemplate dt = deviceTemplateRepository.findById(UUID.fromString(id))
                .orElseThrow(() -> new ResourceNotFoundException("DeviceTemplate", UUID.fromString(id)));

        if (dt.getTenant() != null) {
            if (!authService.isManagerInTenant(dt.getTenant().getId())) {
                return ResponseEntity.status(403).body(Map.of("message", "Manager role required in tenant"));
            }
        } else {
            if (!authService.isSystemAdmin()) {
                return ResponseEntity.status(403).body(Map.of("message", "System admin required for system-wide templates"));
            }
        }

        dt.setActive(false);
        dt.setUpdatedAt(Instant.now());
        deviceTemplateRepository.save(dt);

        log.info("Soft-deleted device template: {} (id: {})", dt.getName(), dt.getId());
        return ResponseEntity.ok(Map.of("message", "Device template deleted"));
    }

    // ── AI Template Generation ────────────────────────────────────────────────

    /**
     * POST /api/v1/templates/generate
     *
     * Calls the n8n AI Template Builder workflow to generate a device template
     * from a sensor name (dry-run — not persisted). The n8n URL and credentials
     * are kept exclusively in the core-platform environment; the frontend never
     * sees them.
     *
     * Request body: { "sensorName": "..." }
     * Response: { sensorName, confidence, sources, status, payload }
     */
    @PostMapping("/templates/generate")
    public ResponseEntity<Map<String, Object>> generateTemplate(@RequestBody Map<String, Object> body) {
        log.info("REST POST /api/v1/templates/generate");

        if (templateWebhookUrl == null || templateWebhookUrl.isBlank()) {
            return ResponseEntity.status(503).body(Map.of("message", "Template generation is not configured"));
        }

        String sensorName = body.get("sensorName") instanceof String s ? s.strip() : null;
        if (sensorName == null || sensorName.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("message", "'sensorName' is required"));
        }

        try {
            Map<String, Object> payload = Map.of("sensorNames", List.of(sensorName), "dryRun", true);
            String bodyJson = objectMapper.writeValueAsString(payload);

            HttpRequest.Builder requestBuilder = HttpRequest.newBuilder()
                    .uri(URI.create(templateWebhookUrl))
                    .timeout(Duration.ofSeconds(templateWebhookTimeoutSeconds))
                    .header("Content-Type", "application/json");
            String token = kpiFormulaAiProperties.getWebhookToken();
            if (token != null && !token.isBlank()) {
                requestBuilder.header("Authorization", "Bearer " + token);
            }
            HttpRequest request = requestBuilder
                    .POST(HttpRequest.BodyPublishers.ofString(bodyJson))
                    .build();

            HttpResponse<String> response = HTTP_CLIENT.send(request, HttpResponse.BodyHandlers.ofString());

            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                log.error("n8n template builder error {}: {}", response.statusCode(), response.body());
                return ResponseEntity.status(502)
                        .body(Map.of("message", "Template generation failed (" + response.statusCode() + ")"));
            }

            // Parse n8n response — workflow returns { results: [...] } or a plain array
            Object parsed = objectMapper.readValue(response.body(), Object.class);
            List<?> results;
            if (parsed instanceof Map<?, ?> m && m.get("results") instanceof List<?> r) {
                results = r;
            } else if (parsed instanceof List<?> l) {
                results = l;
            } else {
                results = List.of(parsed);
            }

            if (results.isEmpty()) {
                return ResponseEntity.status(502).body(Map.of("message", "No result returned from AI workflow"));
            }

            @SuppressWarnings("unchecked")
            Map<String, Object> result = (Map<String, Object>) results.get(0);
            String status = (String) result.get("status");

            if ("failed".equals(status)) {
                return ResponseEntity.status(422)
                        .body(Map.of("message", result.getOrDefault("error", "AI generation failed").toString(), "result", result));
            }
            if ("needs_review".equals(status)) {
                return ResponseEntity.status(422)
                        .body(Map.of("message", result.getOrDefault("reason", "AI output needs review").toString(), "result", result));
            }

            Map<String, Object> responseMap = new LinkedHashMap<>();
            responseMap.put("sensorName", result.get("sensorName"));
            responseMap.put("confidence", result.get("confidence"));
            responseMap.put("sources", result.getOrDefault("sources", List.of()));
            responseMap.put("status", status);
            responseMap.put("payload", result.get("payload"));
            return ResponseEntity.ok(responseMap);

        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return ResponseEntity.status(504).body(Map.of("message", "Template generation timed out"));
        } catch (Exception e) {
            log.error("Template generation failed", e);
            return ResponseEntity.internalServerError().body(Map.of("message", "Failed to reach AI workflow"));
        }
    }

    // ── Mappers ───────────────────────────────────────────────────────────────
    
    private Map<String, Object> toObjectTypeMap(ObjectType ot) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("id", ot.getId().toString());
        map.put("name", ot.getName());
        map.put("displayName", ot.getDisplayName());
        map.put("category", ot.getCategory());
        map.put("description", ot.getDescription());
        map.put("icon", ot.getIcon());
        map.put("svgIconUrl", ot.getSvgIconUrl());
        map.put("propertySchema", ot.getPropertySchema());
        map.put("sortOrder", ot.getSortOrder());
        return map;
    }
    
    /**
     * Safely convert a request body value to a JSON string for JSONB columns.
     * Jackson may deserialize the value as a String, Map, or List depending on the input.
     */
    private String toJsonString(Object value) {
        if (value == null) return null;
        if (value instanceof String s) return s.isBlank() ? null : s;
        // Jackson deserialized a JSON object/array — re-serialize to string
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception e) {
            log.warn("Failed to serialize JSONB value of type {}: {}", value.getClass().getSimpleName(), e.getMessage());
            return null;
        }
    }

    private Map<String, Object> toDeviceTemplateMap(DeviceTemplate dt) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("id", dt.getId().toString());
        map.put("tenantId", dt.getTenant() != null ? dt.getTenant().getId().toString() : null);
        map.put("name", dt.getName());
        map.put("manufacturer", dt.getManufacturer());
        map.put("modelNumber", dt.getModelNumber());
        map.put("description", dt.getDescription());
        map.put("protocol", dt.getProtocol());
        map.put("defaultSignalMap", dt.getDefaultSignalMap());
        map.put("defaultSpecs", dt.getDefaultSpecs());
        map.put("secretsSchema", dt.getSecretsSchema());
        map.put("sortOrder", dt.getSortOrder());
        
        if (dt.getObjectType() != null) {
            Map<String, Object> otMap = new LinkedHashMap<>();
            otMap.put("id", dt.getObjectType().getId().toString());
            otMap.put("name", dt.getObjectType().getName());
            otMap.put("displayName", dt.getObjectType().getDisplayName());
            otMap.put("category", dt.getObjectType().getCategory());
            otMap.put("icon", dt.getObjectType().getIcon());
            map.put("objectType", otMap);
        }
        
        return map;
    }
}
