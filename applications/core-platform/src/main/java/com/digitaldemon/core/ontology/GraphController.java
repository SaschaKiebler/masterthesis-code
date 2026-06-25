package com.digitaldemon.core.ontology;

import com.digitaldemon.core.ontology.Link;
import com.digitaldemon.core.ontology.LinkType;
import com.digitaldemon.core.ontology.ObjectEntity;
import com.digitaldemon.core.device.PhysicalDevice;
import com.digitaldemon.core.project.ProjectObject;
import com.digitaldemon.core.common.exception.ResourceNotFoundException;
import com.digitaldemon.core.common.exception.ServiceException;
import com.digitaldemon.core.common.exception.ValidationException;
import com.digitaldemon.core.metricpoint.MetricPoint;
import com.digitaldemon.core.ontology.LinkRepository;
import com.digitaldemon.core.ontology.LinkTypeRepository;
import com.digitaldemon.core.metricpoint.MetricPointRepository;
import com.digitaldemon.core.ontology.ObjectRepository;
import com.digitaldemon.core.ontology.ObjectTypeRepository;
import com.digitaldemon.core.device.PhysicalDeviceRepository;
import com.digitaldemon.core.project.ProjectObjectRepository;
import com.digitaldemon.core.user.AuthService;
import com.digitaldemon.core.metricpoint.MetricPointService;
import com.digitaldemon.core.ontology.OntologyService;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Graph API — ADR-011 Phase C.
 */
@Slf4j
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class GraphController {

    private final OntologyService ontologyService;
    private final MetricPointService metricPointService;
    private final LinkTypeRepository linkTypeRepository;
    private final LinkRepository linkRepository;
    private final MetricPointRepository metricPointRepository;
    private final ObjectRepository objectRepository;
    private final ObjectTypeRepository objectTypeRepository;
    private final ProjectObjectRepository projectObjectRepository;
    private final PhysicalDeviceRepository physicalDeviceRepository;
    private final AuthService authService;

    // =========================================================================
    // GET /api/v1/link-types
    // =========================================================================

    @GetMapping("/link-types")
    public ResponseEntity<?> listLinkTypes() {
        log.info("GET /api/v1/link-types");
        List<Map<String, Object>> types = linkTypeRepository.findAll()
                .stream()
                .sorted(Comparator.comparing(LinkType::getName))
                .map(this::toLinkTypeMap)
                .collect(Collectors.toList());
        return ResponseEntity.ok(Map.of("linkTypes", types));
    }

    // =========================================================================
    // POST /api/v1/link-types
    // =========================================================================

    @PostMapping("/link-types")
    public ResponseEntity<?> createLinkType(@RequestBody Map<String, Object> body) {
        log.info("POST /api/v1/link-types");

        String rawName    = (String) body.get("name");
        String displayName = (String) body.get("displayName");

        if (rawName == null || rawName.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("message", "name is required"));
        }
        if (displayName == null || displayName.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("message", "displayName is required"));
        }

        String name = rawName.trim().toUpperCase().replace(' ', '_');

        if (linkTypeRepository.findByName(name).isPresent()) {
            return ResponseEntity.status(409).body(Map.of("message", "Link type already exists: " + name));
        }

        try {
            LinkType lt = ontologyService.createLinkType(
                    name,
                    displayName.trim(),
                    (String) body.get("description"),
                    (String) body.get("inverseName")
            );
            return ResponseEntity.status(201).body(Map.of("linkType", toLinkTypeMap(lt)));
        } catch (Exception e) {
            log.error("Error creating link type {}: {}", name, e.getMessage(), e);
            return ResponseEntity.internalServerError().body(Map.of("message", "Failed to create link type"));
        }
    }

    // =========================================================================
    // GET /api/v1/sites/{siteId}/objects
    // =========================================================================

    @GetMapping("/sites/{siteId}/objects")
    public ResponseEntity<?> getSiteObjects(@PathVariable String siteId) {
        log.info("GET /api/v1/sites/{}/objects", siteId);

        UUID siteUuid = parseUUID(siteId, "site ID");

        if (!authService.canAccessSite(siteUuid)) {
            return ResponseEntity.status(403).body(Map.of("message", "Access denied to site"));
        }

        Set<UUID> ids = resolveSiteObjectIds(siteUuid);

        List<Map<String, Object>> objects = objectRepository.findAllWithTypeByIdIn(ids)
                .stream()
                .sorted(Comparator.comparing(o -> o.getDisplayName() != null ? o.getDisplayName() : ""))
                .map(this::toObjectMap)
                .collect(Collectors.toList());

        return ResponseEntity.ok(Map.of("objects", objects));
    }

    // =========================================================================
    // GET /api/v1/sites/{siteId}/graph
    // =========================================================================

    @GetMapping("/sites/{siteId}/graph")
    public ResponseEntity<?> getSiteGraph(@PathVariable String siteId) {
        log.info("GET /api/v1/sites/{}/graph", siteId);

        UUID siteUuid = parseUUID(siteId, "site ID");

        if (!authService.canAccessSite(siteUuid)) {
            return ResponseEntity.status(403).body(Map.of("message", "Access denied to site"));
        }

        Set<UUID> ids = resolveSiteObjectIds(siteUuid);

        List<Map<String, Object>> objects = objectRepository.findAllWithTypeByIdIn(ids)
                .stream()
                .sorted(Comparator.comparing(o -> o.getDisplayName() != null ? o.getDisplayName() : ""))
                .map(this::toObjectMap)
                .collect(Collectors.toList());

        List<Map<String, Object>> links = ids.isEmpty() ? List.of()
                : linkRepository.findAllWithinObjectIds(ids)
                .stream()
                .map(this::toLinkMap)
                .collect(Collectors.toList());

        return ResponseEntity.ok(Map.of("objects", objects, "links", links));
    }

    private Set<UUID> resolveSiteObjectIds(UUID siteId) {
        Set<UUID> ids = new LinkedHashSet<>();
        ids.add(siteId);
        collectContainedIds(siteId, ids);
        ids.addAll(ontologyService.findSourceIds(siteId, OntologyService.INSTALLED_AT));
        return ids;
    }

    private void collectContainedIds(UUID rootId, Set<UUID> collector) {
        for (var child : ontologyService.getOutboundNeighbors(rootId, OntologyService.CONTAINS)) {
            collector.add(child.getId());
            collectContainedIds(child.getId(), collector);
        }
    }

    // =========================================================================
    // POST /api/v1/objects
    // =========================================================================

    @PostMapping("/objects")
    public ResponseEntity<?> createObject(@RequestBody Map<String, Object> body) {
        log.info("POST /api/v1/objects");

        String objectTypeName = (String) body.get("objectTypeName");
        String displayName    = (String) body.get("displayName");
        String tenantIdStr    = (String) body.get("tenantId");
        String projectIdStr   = (String) body.get("projectId");

        if (objectTypeName == null || objectTypeName.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("message", "objectTypeName is required"));
        }
        if (displayName == null || displayName.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("message", "displayName is required"));
        }
        if (tenantIdStr == null || tenantIdStr.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("message", "tenantId is required"));
        }

        UUID tenantId = parseUUID(tenantIdStr, "tenantId");

        try {
            ObjectEntity created = ontologyService.createObject(
                objectTypeName.toUpperCase(), tenantId, displayName.trim());

            if (projectIdStr != null && !projectIdStr.isBlank()) {
                UUID projectId = parseUUID(projectIdStr, "projectId");
                ProjectObject po = new ProjectObject();
                po.setProjectId(projectId);
                po.setObjectId(created.getId());
                po.setAddedAt(Instant.now());
                projectObjectRepository.save(po);
                log.info("Registered object {} in project {}", created.getId(), projectId);
            }

            // If a device extension payload is provided, set specs in properties
            @SuppressWarnings("unchecked")
            Map<String, Object> devicePayload = (Map<String, Object>) body.get("device");
            if (devicePayload != null) {
                applyDeviceSpecs(created, devicePayload);
            }

            return ResponseEntity.status(201).body(Map.of("object", toObjectMap(created)));
        } catch (ServiceException e) {
            int status = e instanceof ResourceNotFoundException ? 404 : 400;
            return ResponseEntity.status(status).body(Map.of("message", e.getMessage()));
        }
    }

    // =========================================================================
    // GET /api/v1/objects/{objectId}/device
    // =========================================================================

    @GetMapping("/objects/{objectId}/device")
    public ResponseEntity<?> getDeviceConfig(@PathVariable String objectId) {
        log.info("GET /api/v1/objects/{}/device", objectId);

        UUID objectUuid = parseUUID(objectId, "object ID");

        ObjectEntity obj = objectRepository.findById(objectUuid).orElse(null);
        if (obj == null) {
            return ResponseEntity.status(404).body(Map.of("message", "Object not found"));
        }

        return ResponseEntity.ok(Map.of("device", toDeviceConfigMap(obj)));
    }

    // =========================================================================
    // PATCH /api/v1/objects/{objectId}/device
    // =========================================================================

    @PatchMapping("/objects/{objectId}/device")
    public ResponseEntity<?> updateDeviceConfig(
            @PathVariable String objectId,
            @RequestBody Map<String, Object> body) {
        log.info("PATCH /api/v1/objects/{}/device", objectId);

        UUID objectUuid = parseUUID(objectId, "object ID");

        ObjectEntity obj;
        try {
            obj = ontologyService.getObject(objectUuid);
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        }

        try {
            // Update specs in properties
            Object specsObj = body.get("specs");
            if (specsObj != null) {
                String specsStr = specsObj instanceof String
                        ? (String) specsObj
                        : new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(specsObj);
                String newProps = OntologyService.mergeProperty(obj.getProperties(), "specs", specsStr);
                obj.setProperties(newProps);
                obj.setUpdatedAt(Instant.now());
                objectRepository.save(obj);
            }

            // device_id and model live on PhysicalDevice (REALIZED_BY link)
            String deviceId = (String) body.get("deviceId");
            String modelHuman = (String) body.get("modelHuman");
            if (deviceId != null || modelHuman != null) {
                UUID physicalDeviceId = ontologyService.resolveTargetId(objectUuid, OntologyService.REALIZED_BY);
                if (physicalDeviceId != null) {
                    physicalDeviceRepository.findById(physicalDeviceId).ifPresent(pd -> {
                        if (deviceId != null && !deviceId.isBlank()) {
                            pd.setDeviceId(deviceId.trim());
                        }
                        if (modelHuman != null) {
                            pd.setModel(modelHuman.trim().isEmpty() ? null : modelHuman.trim());
                        }
                        pd.setUpdatedAt(Instant.now());
                        physicalDeviceRepository.save(pd);
                    });
                } else if (deviceId != null && !deviceId.isBlank()) {
                    PhysicalDevice existingPd = physicalDeviceRepository.findByDeviceId(deviceId.trim()).orElse(null);
                    if (existingPd != null) {
                        if (modelHuman != null) {
                            existingPd.setModel(modelHuman.trim().isEmpty() ? null : modelHuman.trim());
                        }
                        existingPd.setUpdatedAt(Instant.now());
                        physicalDeviceRepository.save(existingPd);
                        ontologyService.upsertLink(objectUuid, existingPd.getId(), OntologyService.REALIZED_BY);
                        log.info("Re-linked existing PhysicalDevice {} with REALIZED_BY link from object {}", existingPd.getId(), objectUuid);
                    } else {
                        UUID tenantId = obj.getTenant() != null ? obj.getTenant().getId() : null;
                        ObjectEntity pdObj = ontologyService.createObject(
                            OntologyService.PHYSICAL_DEVICE, tenantId, deviceId.trim());
                        PhysicalDevice pd = new PhysicalDevice();
                        pd.setId(pdObj.getId());
                        pd.setDeviceId(deviceId.trim());
                        pd.setModel(modelHuman != null && !modelHuman.trim().isEmpty() ? modelHuman.trim() : null);
                        pd.setCreatedAt(Instant.now());
                        pd.setUpdatedAt(Instant.now());
                        physicalDeviceRepository.save(pd);
                        ontologyService.upsertLink(objectUuid, pdObj.getId(), OntologyService.REALIZED_BY);
                        log.info("Created PhysicalDevice {} with REALIZED_BY link from object {}", pdObj.getId(), objectUuid);
                    }
                }
            }

            log.info("Saved device config for object {}", objectUuid);

            // Process signalMap
            Object signalMapObj = body.get("signalMap");
            if (signalMapObj != null) {
                processSignalMap(objectUuid, obj, body, signalMapObj);
            }

            return ResponseEntity.ok(Map.of("device", toDeviceConfigMap(obj)));
        } catch (ServiceException e) {
            int status = e instanceof ResourceNotFoundException ? 404 : 400;
            return ResponseEntity.status(status).body(Map.of("message", e.getMessage()));
        } catch (Exception e) {
            log.error("Error updating device config for {}: {}", objectId, e.getMessage(), e);
            return ResponseEntity.internalServerError().body(Map.of("message", "Failed to update device config"));
        }
    }

    // =========================================================================
    // DELETE /api/v1/objects/{objectId}
    // =========================================================================

    @DeleteMapping("/objects/{objectId}")
    public ResponseEntity<?> deleteObject(@PathVariable String objectId) {
        log.info("DELETE /api/v1/objects/{}", objectId);

        UUID objectUuid = parseUUID(objectId, "object ID");

        try {
            ontologyService.deleteObject(objectUuid);
            return ResponseEntity.noContent().build();
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        }
    }

    // =========================================================================
    // PATCH /api/v1/objects/{objectId}
    // =========================================================================

    @PatchMapping("/objects/{objectId}")
    public ResponseEntity<?> updateObject(
            @PathVariable String objectId,
            @RequestBody Map<String, Object> body) {
        log.info("PATCH /api/v1/objects/{}", objectId);

        UUID objectUuid = parseUUID(objectId, "object ID");
        String displayName = (String) body.get("displayName");

        if (displayName == null || displayName.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("message", "displayName is required"));
        }

        try {
            ontologyService.updateDisplayName(objectUuid, displayName.trim());
            ObjectEntity updated = ontologyService.getObject(objectUuid);
            return ResponseEntity.ok(Map.of("object", toObjectMap(updated)));
        } catch (ServiceException e) {
            int status = e instanceof ResourceNotFoundException ? 404 : 400;
            return ResponseEntity.status(status).body(Map.of("message", e.getMessage()));
        }
    }

    // =========================================================================
    // PATCH /api/v1/objects/{objectId}/properties — ADR-014 Custom Properties
    // =========================================================================

    @PatchMapping("/objects/{objectId}/properties")
    public ResponseEntity<?> updateObjectProperties(
            @PathVariable String objectId,
            @RequestBody Map<String, Object> body) {
        log.info("PATCH /api/v1/objects/{}/properties", objectId);

        UUID objectUuid = parseUUID(objectId, "object ID");

        try {
            ObjectEntity obj = ontologyService.getObject(objectUuid);

            // Read existing custom values and merge incoming (don't overwrite unmentioned keys)
            String currentCustom = OntologyService.extractProperty(obj.getProperties(), "custom");
            Map<String, Object> merged = new LinkedHashMap<>();
            if (currentCustom != null && !currentCustom.isBlank()) {
                try {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> existing = new com.fasterxml.jackson.databind.ObjectMapper()
                            .readValue(currentCustom, Map.class);
                    merged.putAll(existing);
                } catch (Exception ignored) {}
            }
            merged.putAll(body);

            String mergedJson = new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(merged);
            String newProps = OntologyService.mergeProperty(obj.getProperties(), "custom", mergedJson);
            obj.setProperties(newProps);
            obj.setUpdatedAt(Instant.now());
            objectRepository.save(obj);

            return ResponseEntity.ok(Map.of("object", toObjectMap(obj)));
        } catch (ServiceException e) {
            int status = e instanceof ResourceNotFoundException ? 404 : 400;
            return ResponseEntity.status(status).body(Map.of("message", e.getMessage()));
        } catch (Exception e) {
            log.error("Error updating properties for {}: {}", objectId, e.getMessage(), e);
            return ResponseEntity.internalServerError()
                    .body(Map.of("message", "Failed to update properties"));
        }
    }

    // =========================================================================
    // GET /api/v1/objects/{objectId}/links
    // =========================================================================

    @GetMapping("/objects/{objectId}/links")
    public ResponseEntity<?> getObjectLinks(@PathVariable String objectId) {
        log.info("GET /api/v1/objects/{}/links", objectId);

        UUID objectUuid = parseUUID(objectId, "object ID");

        OntologyService.ObjectLinksResult result = ontologyService.getLinksForObject(objectUuid);

        return ResponseEntity.ok(Map.of(
                "outbound", result.outbound().stream().map(this::toLinkMap).collect(Collectors.toList()),
                "inbound",  result.inbound().stream().map(this::toLinkMap).collect(Collectors.toList())
        ));
    }

    // =========================================================================
    // POST /api/v1/links
    // =========================================================================

    @PostMapping("/links")
    public ResponseEntity<?> createLink(@RequestBody Map<String, Object> body) {
        log.info("POST /api/v1/links");

        String sourceIdStr   = (String) body.get("sourceId");
        String targetIdStr   = (String) body.get("targetId");
        String linkTypeName  = (String) body.get("linkTypeName");

        if (sourceIdStr == null || sourceIdStr.isBlank()
                || targetIdStr == null || targetIdStr.isBlank()
                || linkTypeName == null || linkTypeName.isBlank()) {
            return ResponseEntity.badRequest()
                    .body(Map.of("message", "sourceId, targetId, and linkTypeName are required"));
        }

        UUID sourceId = parseUUID(sourceIdStr, "sourceId");
        UUID targetId = parseUUID(targetIdStr, "targetId");

        try {
            Link link = ontologyService.createLink(sourceId, targetId, linkTypeName.toUpperCase());
            return ResponseEntity.status(201).body(Map.of("link", toLinkMap(link)));
        } catch (ServiceException e) {
            int status = e instanceof ResourceNotFoundException ? 404 : 400;
            return ResponseEntity.status(status).body(Map.of("message", e.getMessage()));
        } catch (Exception e) {
            log.error("Error creating link {}→{} ({}): {}", sourceIdStr, targetIdStr, linkTypeName, e.getMessage(), e);
            return ResponseEntity.internalServerError().body(Map.of("message", "Failed to create link"));
        }
    }

    // =========================================================================
    // DELETE /api/v1/links/{linkId}
    // =========================================================================

    @DeleteMapping("/links/{linkId}")
    public ResponseEntity<?> deleteLink(@PathVariable String linkId) {
        log.info("DELETE /api/v1/links/{}", linkId);

        UUID linkUuid = parseUUID(linkId, "link ID");

        try {
            ontologyService.deleteLink(linkUuid);
            return ResponseEntity.noContent().build();
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        } catch (Exception e) {
            log.error("Error deleting link {}: {}", linkId, e.getMessage(), e);
            return ResponseEntity.internalServerError().body(Map.of("message", "Failed to delete link"));
        }
    }

    // =========================================================================
    // Serialisation helpers
    // =========================================================================

    private Map<String, Object> toObjectMap(ObjectEntity o) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("id", o.getId().toString());
        map.put("displayName", o.getDisplayName());
        map.put("objectTypeName", o.getObjectType().getName());
        map.put("objectTypeDisplayName", o.getObjectType().getDisplayName());
        map.put("objectTypeCategory", o.getObjectType().getCategory());
        map.put("objectTypeIcon", o.getObjectType().getIcon());
        map.put("objectTypeSvgIconUrl", o.getObjectType().getSvgIconUrl());
        map.put("objectTypePropertySchema", o.getObjectType().getPropertySchema());
        map.put("properties", o.getProperties());
        return map;
    }

    /**
     * Build device config map for a graph object.
     * Specs from properties, device_id/model from linked PhysicalDevice (REALIZED_BY).
     */
    private Map<String, Object> toDeviceConfigMap(ObjectEntity obj) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("objectId", obj.getId().toString());
        map.put("name", obj.getDisplayName());
        String specs = OntologyService.extractProperty(obj.getProperties(), "specs");
        map.put("specs", specs != null ? specs : "{}");

        UUID physicalDeviceId = ontologyService.resolveTargetId(obj.getId(), OntologyService.REALIZED_BY);
        if (physicalDeviceId != null) {
            physicalDeviceRepository.findById(physicalDeviceId).ifPresent(pd -> {
                map.put("deviceId", pd.getDeviceId());
                map.put("modelHuman", pd.getModel());
            });
        } else {
            map.put("deviceId", null);
            map.put("modelHuman", null);
        }

        try {
            List<Object[]> rows = metricPointRepository.findSignalMapRowsByAssetId(obj.getId());
            if (!rows.isEmpty()) {
                Map<String, Object> signalMap = new LinkedHashMap<>();
                for (Object[] row : rows) {
                    String key = String.valueOf(row[0]);
                    Map<String, Object> entry = new LinkedHashMap<>();
                    entry.put("name",   row[1]);
                    entry.put("unit",   row[2] != null ? row[2] : "");
                    if (row[3] != null) entry.put("source", row[3]);
                    if (row[4] != null) entry.put("field",  row[4]);
                    if (row[5] != null) entry.put("min",    row[5]);
                    if (row[6] != null) entry.put("max",    row[6]);
                    signalMap.put(key, entry);
                }
                map.put("signalMap", new com.fasterxml.jackson.databind.ObjectMapper()
                        .writeValueAsString(signalMap));
            } else {
                map.put("signalMap", null);
            }
        } catch (Exception e) {
            log.warn("Failed to reconstruct signal map for object {}: {}", obj.getId(), e.getMessage());
            map.put("signalMap", null);
        }

        return map;
    }

    /**
     * Apply device specs from payload into the object's properties.
     */
    private void applyDeviceSpecs(ObjectEntity obj, Map<String, Object> devicePayload) {
        try {
            Object specsObj = devicePayload.get("specs");
            if (specsObj != null) {
                String specs = specsObj instanceof String
                        ? (String) specsObj
                        : new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(specsObj);
                String newProps = OntologyService.mergeProperty(obj.getProperties(), "specs", specs);
                obj.setProperties(newProps);
                obj.setUpdatedAt(Instant.now());
                objectRepository.save(obj);
            }
        } catch (Exception e) {
            log.warn("Failed to apply device specs for object {}: {}", obj.getId(), e.getMessage());
        }
    }

    private Map<String, Object> toLinkMap(Link l) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("id", l.getId().toString());

        ObjectEntity source = l.getSource();
        map.put("sourceId", source.getId().toString());
        map.put("sourceName", source.getDisplayName());
        map.put("sourceTypeName", source.getObjectType() != null ? source.getObjectType().getName() : null);

        ObjectEntity target = l.getTarget();
        map.put("targetId", target.getId().toString());
        map.put("targetName", target.getDisplayName());
        map.put("targetTypeName", target.getObjectType() != null ? target.getObjectType().getName() : null);

        map.put("linkTypeName", l.getLinkType().getName());
        map.put("linkTypeDisplayName", l.getLinkType().getDisplayName());
        map.put("createdAt", l.getCreatedAt() != null ? l.getCreatedAt().getEpochSecond() : null);
        return map;
    }

    private Map<String, Object> toLinkTypeMap(LinkType lt) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("id", lt.getId().toString());
        map.put("name", lt.getName());
        map.put("displayName", lt.getDisplayName());
        map.put("description", lt.getDescription());
        map.put("inverseName", lt.getInverseName());
        return map;
    }

    private void processSignalMap(UUID objectUuid, ObjectEntity obj,
                                   Map<String, Object> body, Object signalMapObj) {
        String resolvedDeviceId = resolveDeviceIdForMetricPoints(objectUuid, body);
        if (resolvedDeviceId == null) {
            log.warn("Cannot process metric points for object {} — no device ID available", objectUuid);
            return;
        }

        UUID tenantId = obj.getTenant() != null ? obj.getTenant().getId() : null;
        Map<String, Object> signalMap = parseSignalMap(signalMapObj);

        metricPointService.reconcileSignalMap(objectUuid, resolvedDeviceId, signalMap, tenantId);
    }

    private String resolveDeviceIdForMetricPoints(UUID objectUuid, Map<String, Object> body) {
        String bodyDeviceId = (String) body.get("deviceId");
        if (bodyDeviceId != null && !bodyDeviceId.isBlank()) {
            return bodyDeviceId.trim();
        }

        UUID physicalDeviceId = ontologyService.resolveTargetId(objectUuid, OntologyService.REALIZED_BY);
        if (physicalDeviceId != null) {
            return physicalDeviceRepository.findById(physicalDeviceId)
                .map(PhysicalDevice::getDeviceId)
                .orElse(null);
        }

        return null;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> parseSignalMap(Object signalMapObj) {
        if (signalMapObj instanceof Map) {
            return (Map<String, Object>) signalMapObj;
        }
        if (signalMapObj instanceof String str) {
            try {
                return new com.fasterxml.jackson.databind.ObjectMapper().readValue(
                    str, new com.fasterxml.jackson.core.type.TypeReference<Map<String, Object>>() {});
            } catch (Exception e) {
                log.warn("Failed to parse signal map JSON string: {}", e.getMessage());
                return Map.of();
            }
        }
        return Map.of();
    }

    private UUID parseUUID(String value, String fieldName) {
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException e) {
            throw new ValidationException("Invalid " + fieldName + " format: " + value);
        }
    }
}
