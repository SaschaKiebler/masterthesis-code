package com.digitaldemon.core.project;

import com.digitaldemon.core.tenancy.TenantBodyGuard;
import com.digitaldemon.core.tenancy.ResourceKind;
import com.digitaldemon.core.project.ProjectHealthDTO;
import com.digitaldemon.core.derivedproperty.DerivedProperty;
import com.digitaldemon.core.event.Event;
import com.digitaldemon.core.ontology.Link;
import com.digitaldemon.core.metricpoint.MetricPoint;
import com.digitaldemon.core.ontology.ObjectEntity;
import com.digitaldemon.core.common.exception.ResourceNotFoundException;
import com.digitaldemon.core.common.exception.ValidationException;
import com.digitaldemon.core.derivedproperty.DerivedPropertyRepository;
import com.digitaldemon.core.event.EventRepository;
import com.digitaldemon.core.measurement.ChannelResolver;
import com.digitaldemon.core.measurement.LatestValueProjection;
import com.digitaldemon.core.metricpoint.MetricPointRepository;
import com.digitaldemon.core.ontology.ObjectRepository;
import com.digitaldemon.core.user.AuthService;
import com.digitaldemon.core.metricpoint.MetricPointService;
import com.digitaldemon.core.ontology.OntologyService;
import com.digitaldemon.core.physicalquantity.PhysicalQuantityService;
import com.digitaldemon.core.project.ProjectService.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

/**
 * ProjectController — REST API for project management (ADR-012) and
 * project-scoped analytics endpoints (ADR-013 C.5).
 *
 * CRUD + Sites:
 *   POST   /api/v1/projects                       — create project
 *   GET    /api/v1/projects                        — list projects (tenant-scoped)
 *   GET    /api/v1/projects/{id}                   — get project with sites
 *   PATCH  /api/v1/projects/{id}                   — update project
 *   DELETE /api/v1/projects/{id}                   — delete project
 *   POST   /api/v1/projects/{id}/sites             — add site to project
 *   DELETE /api/v1/projects/{id}/sites/{siteId}    — remove site from project
 *   GET    /api/v1/projects/{id}/graph             — full graph across all project sites
 *
 * Analytics (ADR-013):
 *   GET    /api/v1/projects/{id}/metric-points     — all metric points in project scope
 *   GET    /api/v1/projects/{id}/measurements      — measurements by metricPointIds
 *   GET    /api/v1/projects/{id}/metric-pairs      — paired metric points for ΔT etc.
 *   GET    /api/v1/projects/{id}/events            — events in project scope
 *   GET    /api/v1/projects/{id}/derived-properties — derived properties in project scope
 *   GET    /api/v1/projects/{id}/compare           — cross-building comparison
 *   GET    /api/v1/projects/{id}/health            — device-level health per building
 *   GET    /api/v1/projects/{id}/latest-values     — latest measurement per metric point
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/projects")
@RequiredArgsConstructor
public class ProjectController {

    private final ProjectService projectService;
    private final AuthService authService;
    private final MetricPointRepository metricPointRepository;
    private final ChannelResolver channelResolver;
    private final LatestValueProjection latestValueProjection;
    private final EventRepository eventRepository;
    private final DerivedPropertyRepository derivedPropertyRepository;
    private final ObjectRepository objectRepository;
    private final OntologyService ontologyService;
    private final TenantBodyGuard tenantBodyGuard;

    // ─── List projects ────────────────────────────────────────────────────────

    @GetMapping
    public ResponseEntity<?> listProjects() {
        log.info("GET /api/v1/projects");

        List<UUID> tenantIds = authService.getAccessibleTenantIds();
        // Empty list means system_admin → no filter (see AuthService)
        List<ProjectDTO> projects = projectService.listProjects(
            tenantIds.isEmpty() ? null : tenantIds
        );

        return ResponseEntity.ok(Map.of("projects", projects));
    }

    // ─── Get project ──────────────────────────────────────────────────────────

    @GetMapping("/{id}")
    public ResponseEntity<?> getProject(@PathVariable String id) {
        log.info("GET /api/v1/projects/{}", id);
        UUID projectId = parseUUID(id, "project ID");

        try {
            ProjectDetailDTO detail = projectService.getProject(projectId);
            return ResponseEntity.ok(Map.of("project", detail));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        }
    }

    // ─── Create project ───────────────────────────────────────────────────────

    @PostMapping
    public ResponseEntity<?> createProject(@RequestBody Map<String, Object> body) {
        log.info("POST /api/v1/projects");

        String name = (String) body.get("name");
        String description = (String) body.get("description");
        String tenantIdStr = (String) body.get("tenantId");

        if (tenantIdStr == null || tenantIdStr.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("message", "tenantId is required"));
        }

        UUID tenantId = parseUUID(tenantIdStr, "tenantId");
        tenantBodyGuard.requireTenant(tenantId);

        try {
            ProjectDTO created = projectService.createProject(
                new CreateProjectRequest(name, description, tenantId)
            );
            return ResponseEntity.status(201).body(Map.of("project", created));
        } catch (ValidationException e) {
            return ResponseEntity.badRequest().body(Map.of("message", e.getMessage()));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        }
    }

    // ─── Update project ───────────────────────────────────────────────────────

    @PatchMapping("/{id}")
    public ResponseEntity<?> updateProject(
            @PathVariable String id,
            @RequestBody Map<String, Object> body) {
        log.info("PATCH /api/v1/projects/{}", id);
        UUID projectId = parseUUID(id, "project ID");

        String name = (String) body.get("name");
        String description = (String) body.get("description");
        String status = (String) body.get("status");

        try {
            ProjectDTO updated = projectService.updateProject(projectId,
                new UpdateProjectRequest(name, description, status));
            return ResponseEntity.ok(Map.of("project", updated));
        } catch (ValidationException e) {
            return ResponseEntity.badRequest().body(Map.of("message", e.getMessage()));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        }
    }

    // ─── Delete project ───────────────────────────────────────────────────────

    @DeleteMapping("/{id}")
    public ResponseEntity<?> deleteProject(@PathVariable String id) {
        log.info("DELETE /api/v1/projects/{}", id);
        UUID projectId = parseUUID(id, "project ID");

        try {
            projectService.deleteProject(projectId);
            return ResponseEntity.noContent().build();
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        }
    }

    // ─── Add site to project ──────────────────────────────────────────────────

    @PostMapping("/{id}/sites")
    public ResponseEntity<?> addSite(
            @PathVariable String id,
            @RequestBody Map<String, Object> body) {
        log.info("POST /api/v1/projects/{}/sites", id);
        UUID projectId = parseUUID(id, "project ID");

        String siteIdStr = (String) body.get("siteId");
        if (siteIdStr == null || siteIdStr.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("message", "siteId is required"));
        }
        UUID siteId = parseUUID(siteIdStr, "siteId");
        // The site arrives in the body, so the interceptor never saw it. Without
        // this, a foreign site added to an owned project turns every
        // project-scoped read into a read of the other tenant.
        tenantBodyGuard.requireAccess(ResourceKind.OBJECT, siteId);

        try {
            projectService.addSiteToProject(projectId, siteId);
            return ResponseEntity.status(201).body(Map.of("message", "Site added to project"));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        }
    }

    // ─── Remove site from project ─────────────────────────────────────────────

    @DeleteMapping("/{id}/sites/{siteId}")
    public ResponseEntity<?> removeSite(
            @PathVariable String id,
            @PathVariable String siteId) {
        log.info("DELETE /api/v1/projects/{}/sites/{}", id, siteId);
        UUID projectId = parseUUID(id, "project ID");
        UUID siteUuid = parseUUID(siteId, "site ID");

        try {
            projectService.removeSiteFromProject(projectId, siteUuid);
            return ResponseEntity.noContent().build();
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        }
    }

    // ─── Project settings ─────────────────────────────────────────────────────

    @GetMapping("/{id}/settings")
    public ResponseEntity<?> getProjectSettings(@PathVariable String id) {
        log.info("GET /api/v1/projects/{}/settings", id);
        UUID projectId = parseUUID(id, "project ID");

        try {
            String settings = projectService.getProjectSettings(projectId);
            return ResponseEntity.ok(settings);
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        }
    }

    @PutMapping("/{id}/settings")
    public ResponseEntity<?> updateProjectSettings(
            @PathVariable String id,
            @RequestBody String body) {
        log.info("PUT /api/v1/projects/{}/settings", id);
        UUID projectId = parseUUID(id, "project ID");

        try {
            String updated = projectService.updateProjectSettings(projectId, body);
            return ResponseEntity.ok(updated);
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        }
    }

    // ─── Project graph ────────────────────────────────────────────────────────

    @GetMapping("/{id}/graph")
    public ResponseEntity<?> getProjectGraph(@PathVariable String id) {
        log.info("GET /api/v1/projects/{}/graph", id);
        UUID projectId = parseUUID(id, "project ID");

        try {
            ProjectGraphResult result = projectService.getProjectGraph(projectId);

            List<Map<String, Object>> objectMaps = result.objects().stream()
                .map(this::toObjectMap)
                .collect(Collectors.toList());

            List<Map<String, Object>> linkMaps = result.links().stream()
                .map(this::toLinkMap)
                .collect(Collectors.toList());

            return ResponseEntity.ok(Map.of("objects", objectMaps, "links", linkMaps));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        }
    }

    // =========================================================================
    // ADR-013 C.5 — Project-Scoped Analytics Endpoints
    // =========================================================================

    // ─── Metric points in project scope ───────────────────────────────────────

    @GetMapping("/{id}/metric-points")
    public ResponseEntity<?> getProjectMetricPoints(@PathVariable String id) {
        log.info("GET /api/v1/projects/{}/metric-points", id);
        UUID projectId = parseUUID(id, "project ID");

        try {
            Set<UUID> objectIds = projectService.collectProjectObjectIds(projectId);
            if (objectIds.isEmpty()) {
                return ResponseEntity.ok(Map.of("metricPoints", List.of()));
            }

            List<Object[]> rows = metricPointRepository.findEnrichedByObjectIds(objectIds);
            List<Map<String, Object>> dtos = rows.stream().map(r -> {
                Map<String, Object> dto = new LinkedHashMap<>();
                dto.put("id", toUuidString(r[0]));
                dto.put("deviceId", r[1]);
                dto.put("metricId", r[2] != null ? ((Number) r[2]).intValue() : null);
                dto.put("source", r[3]);
                dto.put("field", r[4]);
                dto.put("unit", r[5]);
                dto.put("minValue", r[6] != null ? ((Number) r[6]).doubleValue() : null);
                dto.put("maxValue", r[7] != null ? ((Number) r[7]).doubleValue() : null);
                dto.put("quantityId", toUuidString(r[8]));
                dto.put("sampleIntervalSeconds", r[9] != null ? ((Number) r[9]).intValue() : null);
                dto.put("displayName", r[10]);
                dto.put("assetId", toUuidString(r[11]));
                dto.put("assetName", r[12]);
                dto.put("assetTypeName", r[13]);
                dto.put("quantityName", r[14]);
                dto.put("quantityDisplayName", r[15]);
                dto.put("dimension", r[16]);
                dto.put("defaultUnit", r[17]);
                return dto;
            }).toList();

            return ResponseEntity.ok(Map.of("metricPoints", dtos));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        }
    }

    // ─── Channels (resolve-then-fetch: series come from analytics via the BFF) ──

    @GetMapping("/{id}/channels")
    public ResponseEntity<?> getProjectChannels(
            @PathVariable String id,
            @RequestParam(required = false) String metricPointIds) {
        log.info("GET /api/v1/projects/{}/channels", id);
        UUID projectId = parseUUID(id, "project ID");

        try {
            Set<UUID> objectIds = projectService.collectProjectObjectIds(projectId);

            List<UUID> mpIds;
            if (metricPointIds != null && !metricPointIds.isBlank()) {
                mpIds = Arrays.stream(metricPointIds.split(","))
                    .map(String::trim)
                    .filter(str -> !str.isEmpty())
                    .map(str -> parseUUID(str, "metricPointId"))
                    .toList();
                // Query-string ids, not path ids: the interceptor only parses
                // tenantId from the query string.
                tenantBodyGuard.requireReferenceToAll(ResourceKind.OBJECT, mpIds);
            } else {
                List<Object[]> rows = metricPointRepository.findEnrichedByObjectIds(objectIds);
                mpIds = rows.stream()
                    .map(r -> (UUID) r[0])
                    .distinct()
                    .toList();
            }

            List<Map<String, Object>> channels = channelResolver.resolveMetricPoints(mpIds)
                .stream().map(ProjectController::channelDto).toList();
            return ResponseEntity.ok(Map.of("channels", channels, "count", channels.size()));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        }
    }

    private static Map<String, Object> channelDto(ChannelResolver.Channel c) {
        Map<String, Object> dto = new LinkedHashMap<>();
        dto.put("metricPointId", c.metricPointId().toString());
        dto.put("deviceId", c.deviceId());
        dto.put("metricId", c.metricId());
        dto.put("metricName", c.displayName());
        dto.put("unit", c.unit());
        dto.put("source", c.source());
        return dto;
    }

    // ─── Metric pairs for ΔT computation ──────────────────────────────────────

    @GetMapping("/{id}/metric-pairs")
    public ResponseEntity<?> getProjectMetricPairs(
            @PathVariable String id,
            @RequestParam String quantity1,
            @RequestParam String quantity2,
            @RequestParam(defaultValue = "HEATING_CIRCUIT") String groupBy) {
        log.info("GET /api/v1/projects/{}/metric-pairs?quantity1={}&quantity2={}&groupBy={}", id, quantity1, quantity2, groupBy);
        UUID projectId = parseUUID(id, "project ID");

        try {
            Set<UUID> objectIds = projectService.collectProjectObjectIds(projectId);
            if (objectIds.isEmpty()) {
                return ResponseEntity.ok(Map.of("pairs", List.of()));
            }

            // Load all objects in scope and filter to groupBy type
            List<ObjectEntity> allObjects = objectRepository.findAllWithTypeByIdIn(objectIds);
            List<ObjectEntity> groupObjects = allObjects.stream()
                .filter(o -> groupBy.equals(o.getObjectType().getName()))
                .toList();

            // Get all enriched metric points in project scope
            List<Object[]> allMetricPoints = metricPointRepository.findEnrichedByObjectIds(objectIds);

            // Build asset → metric points index (keyed by asset ID)
            Map<String, List<Object[]>> metricsByAssetId = allMetricPoints.stream()
                .collect(Collectors.groupingBy(r -> toUuidString(r[11])));

            List<Map<String, Object>> pairs = new ArrayList<>();

            for (ObjectEntity groupObj : groupObjects) {
                // Find assets contained in this group object (via CONTAINS or INSTALLED_IN)
                List<ObjectEntity> children = ontologyService.getOutboundNeighbors(groupObj.getId(), OntologyService.CONTAINS);
                Set<String> childAssetIds = new HashSet<>();
                childAssetIds.add(groupObj.getId().toString());
                for (ObjectEntity child : children) {
                    childAssetIds.add(child.getId().toString());
                }

                // Collect metric points for these assets
                List<Object[]> q1Points = new ArrayList<>();
                List<Object[]> q2Points = new ArrayList<>();
                for (String assetId : childAssetIds) {
                    List<Object[]> mps = metricsByAssetId.getOrDefault(assetId, List.of());
                    for (Object[] mp : mps) {
                        String qName = (String) mp[14]; // quantity_name
                        if (quantity1.equals(qName)) q1Points.add(mp);
                        else if (quantity2.equals(qName)) q2Points.add(mp);
                    }
                }

                // Pair them (first match of each)
                if (!q1Points.isEmpty() && !q2Points.isEmpty()) {
                    Map<String, Object> pair = new LinkedHashMap<>();
                    pair.put("groupObjectId", groupObj.getId().toString());
                    pair.put("groupObjectName", groupObj.getDisplayName());
                    pair.put("groupObjectType", groupObj.getObjectType().getName());
                    pair.put("metricPoint1", toMetricPointSummary(q1Points.get(0)));
                    pair.put("metricPoint2", toMetricPointSummary(q2Points.get(0)));
                    pairs.add(pair);
                }
            }

            return ResponseEntity.ok(Map.of("pairs", pairs));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        }
    }

    // ─── Events in project scope ──────────────────────────────────────────────

    @GetMapping("/{id}/events")
    public ResponseEntity<?> getProjectEvents(
            @PathVariable String id,
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to,
            @RequestParam(required = false) String severity,
            @RequestParam(required = false) String objectIds,
            @RequestParam(defaultValue = "100") int limit,
            @RequestParam(defaultValue = "0") int offset) {
        log.info("GET /api/v1/projects/{}/events", id);
        UUID projectId = parseUUID(id, "project ID");

        try {
            Set<UUID> projectObjectIds = projectService.collectProjectObjectIds(projectId);
            if (projectObjectIds.isEmpty()) {
                return ResponseEntity.ok(Map.of("events", List.of(), "count", 0));
            }

            Instant fromInstant = from != null ? parseInstant(from) : Instant.now().minus(Duration.ofDays(30));
            Instant toInstant = to != null ? parseInstant(to) : Instant.now();

            List<String> severities = severity != null && !severity.isBlank()
                ? Arrays.asList(severity.split(",")) : null;

            Collection<UUID> objectIdFilter = null;
            if (objectIds != null && !objectIds.isBlank()) {
                objectIdFilter = Arrays.stream(objectIds.split(","))
                    .map(String::trim)
                    .filter(s -> !s.isEmpty())
                    .map(s -> parseUUID(s, "objectId"))
                    .toList();
            }

            List<Event> events = eventRepository.findByObjectIdsAndTimeRange(
                projectObjectIds, fromInstant, toInstant, severities, objectIdFilter, limit, offset);

            List<Map<String, Object>> dtos = events.stream().map(this::toEventMap).toList();
            return ResponseEntity.ok(Map.of("events", dtos, "count", dtos.size()));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        }
    }

    // ─── Derived properties in project scope ──────────────────────────────────

    @GetMapping("/{id}/derived-properties")
    public ResponseEntity<?> getProjectDerivedProperties(
            @PathVariable String id,
            @RequestParam(required = false) String objectTypes) {
        log.info("GET /api/v1/projects/{}/derived-properties", id);
        UUID projectId = parseUUID(id, "project ID");

        try {
            Set<UUID> objectIds = projectService.collectProjectObjectIds(projectId);
            if (objectIds.isEmpty()) {
                return ResponseEntity.ok(Map.of("derivedProperties", List.of()));
            }

            // Load objects and optionally filter by type
            List<ObjectEntity> objects = objectRepository.findAllWithTypeByIdIn(objectIds);
            if (objectTypes != null && !objectTypes.isBlank()) {
                Set<String> typeFilter = Set.of(objectTypes.split(","));
                objects = objects.stream()
                    .filter(o -> typeFilter.contains(o.getObjectType().getName()))
                    .toList();
            }

            List<Map<String, Object>> dtos = new ArrayList<>();
            for (ObjectEntity obj : objects) {
                List<DerivedProperty> props = derivedPropertyRepository
                    .findByObjectIdAndValidUntilIsNull(obj.getId());
                for (DerivedProperty dp : props) {
                    Map<String, Object> dto = new LinkedHashMap<>();
                    dto.put("id", dp.getId().toString());
                    dto.put("objectId", dp.getObjectId().toString());
                    dto.put("objectName", obj.getDisplayName());
                    dto.put("objectTypeName", obj.getObjectType().getName());
                    dto.put("propertyName", dp.getPropertyName());
                    dto.put("displayName", dp.getDisplayName());
                    dto.put("valueNumeric", dp.getValueNumeric());
                    dto.put("valueText", dp.getValueText());
                    dto.put("unit", dp.getUnit());
                    dto.put("confidence", dp.getConfidence());
                    dto.put("quality", dp.getQuality());
                    dto.put("sourceType", dp.getSourceType());
                    dto.put("computedAt", dp.getComputedAt() != null ? dp.getComputedAt().getEpochSecond() : null);
                    dtos.add(dto);
                }
            }

            return ResponseEntity.ok(Map.of("derivedProperties", dtos));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        }
    }

    // ─── Cross-building comparison (channels only; series come from analytics) ──

    @GetMapping("/{id}/quantity-channels")
    public ResponseEntity<?> getProjectQuantityChannels(
            @PathVariable String id,
            @RequestParam String quantityName) {
        log.info("GET /api/v1/projects/{}/quantity-channels?quantityName={}", id, quantityName);
        UUID projectId = parseUUID(id, "project ID");

        try {
            List<UUID> siteIds = projectService.getProjectSiteIds(projectId);
            if (siteIds.isEmpty()) {
                return ResponseEntity.ok(Map.of("channels", List.of()));
            }

            List<Map<String, Object>> channels = channelResolver
                .resolveByQuantity(siteIds, quantityName).stream()
                .map(c -> {
                    Map<String, Object> dto = new LinkedHashMap<String, Object>();
                    dto.put("siteId", c.siteId().toString());
                    dto.put("siteName", c.siteName());
                    dto.put("deviceId", c.deviceId());
                    dto.put("metricId", c.metricId());
                    return dto;
                }).toList();

            return ResponseEntity.ok(Map.of("channels", channels));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        }
    }

    // ─── Project health overview ─────────────────────────────────────────────

    @GetMapping("/{id}/health")
    public ResponseEntity<?> getProjectHealth(@PathVariable String id) {
        log.info("GET /api/v1/projects/{}/health", id);
        UUID projectId = parseUUID(id, "project ID");

        try {
            ProjectHealthDTO health = projectService.getProjectHealth(projectId);

            // Serialize to Maps for consistent JSON output
            List<Map<String, Object>> buildingMaps = health.buildings().stream().map(b -> {
                Map<String, Object> bm = new LinkedHashMap<>();
                bm.put("id", b.id().toString());
                bm.put("name", b.name());
                bm.put("status", b.status());
                bm.put("summary", Map.of(
                    "online", b.summary().online(),
                    "stale", b.summary().stale(),
                    "offline", b.summary().offline(),
                    "noData", b.summary().noData()
                ));
                bm.put("devices", b.devices().stream().map(d -> {
                    Map<String, Object> dm = new LinkedHashMap<>();
                    dm.put("objectId", d.objectId().toString());
                    dm.put("deviceId", d.deviceId());
                    dm.put("displayName", d.displayName());
                    dm.put("objectTypeName", d.objectTypeName());
                    dm.put("objectTypeCategory", d.objectTypeCategory());
                    dm.put("status", d.status());
                    dm.put("lastSeenEpoch", d.lastSeenEpoch());
                    return dm;
                }).toList());
                return bm;
            }).toList();

            ProjectHealthDTO.Totals t = health.totals();
            Map<String, Object> totals = Map.of(
                "buildings", t.buildings(),
                "devices", t.devices(),
                "online", t.online(),
                "stale", t.stale(),
                "offline", t.offline()
            );

            return ResponseEntity.ok(Map.of("buildings", buildingMaps, "totals", totals));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        }
    }

    // ─── Latest values for synoptic view ─────────────────────────────────────

    @GetMapping("/{id}/latest-values")
    public ResponseEntity<?> getProjectLatestValues(@PathVariable String id) {
        log.info("GET /api/v1/projects/{}/latest-values", id);
        UUID projectId = parseUUID(id, "project ID");

        try {
            Set<UUID> objectIds = projectService.collectProjectObjectIds(projectId);
            if (objectIds.isEmpty()) {
                return ResponseEntity.ok(Map.of("values", List.of()));
            }

            // Get all metric point IDs in project scope
            List<Object[]> mpRows = metricPointRepository.findEnrichedByObjectIds(objectIds);
            List<UUID> mpIds = mpRows.stream()
                .map(r -> (UUID) r[0])
                .distinct()
                .toList();

            if (mpIds.isEmpty()) {
                return ResponseEntity.ok(Map.of("values", List.of()));
            }

            // Registry context from the resolver, values from the in-memory
            // projection — no measurement-store read.
            List<Map<String, Object>> values = channelResolver.latestValueContext(mpIds)
                .stream().map(c -> {
                    var latest = latestValueProjection.latest(c.deviceId(), c.metricId()).orElse(null);
                    Map<String, Object> v = new LinkedHashMap<String, Object>();
                    v.put("metricPointId", c.metricPointId().toString());
                    v.put("deviceId", c.deviceId());
                    v.put("metricId", c.metricId());
                    v.put("displayName", c.displayName());
                    v.put("unit", c.unit());
                    v.put("quantityName", c.quantityName());
                    v.put("assetObjectId", c.assetObjectId() != null ? c.assetObjectId().toString() : null);
                    v.put("value", latest != null ? latest.value() : null);
                    v.put("time", latest != null ? latest.time().getEpochSecond() : null);
                    return v;
                }).toList();

            return ResponseEntity.ok(Map.of("values", values));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        }
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    private UUID parseUUID(String value, String fieldName) {
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException e) {
            throw new ValidationException("Invalid " + fieldName + " format: " + value);
        }
    }

    private Instant parseInstant(String value) {
        try {
            // Try epoch seconds first
            long epoch = Long.parseLong(value);
            return Instant.ofEpochSecond(epoch);
        } catch (NumberFormatException e) {
            return Instant.parse(value);
        }
    }

    private String toUuidString(Object value) {
        if (value == null) return null;
        if (value instanceof UUID uuid) return uuid.toString();
        return value.toString();
    }

    private Map<String, Object> toMetricPointSummary(Object[] r) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", toUuidString(r[0]));
        m.put("displayName", r[10]);
        m.put("deviceId", r[1]);
        m.put("metricId", r[2] != null ? ((Number) r[2]).intValue() : null);
        m.put("unit", r[5]);
        m.put("assetId", toUuidString(r[11]));
        m.put("assetName", r[12]);
        m.put("quantityName", r[14]);
        m.put("quantityDisplayName", r[15]);
        return m;
    }

    private Map<String, Object> toEventMap(Event e) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", e.getId().toString());
        m.put("time", e.getTime().getEpochSecond());
        m.put("objectId", e.getObjectId().toString());
        m.put("eventType", e.getEventType());
        m.put("severity", e.getSeverity());
        m.put("summary", e.getSummary());
        m.put("details", e.getDetails());
        m.put("source", e.getSource());
        m.put("sourceId", e.getSourceId() != null ? e.getSourceId().toString() : null);
        m.put("resolvedAt", e.getResolvedAt() != null ? e.getResolvedAt().getEpochSecond() : null);
        m.put("resolvedBy", e.getResolvedBy() != null ? e.getResolvedBy().toString() : null);
        m.put("resolutionNote", e.getResolutionNote());
        return m;
    }

    private Map<String, Object> toObjectMap(ObjectEntity obj) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", obj.getId().toString());
        m.put("displayName", obj.getDisplayName());
        m.put("objectTypeName", obj.getObjectType().getName());
        m.put("objectTypeDisplayName", obj.getObjectType().getDisplayName());
        m.put("objectTypeCategory", obj.getObjectType().getCategory());
        m.put("objectTypeIcon", obj.getObjectType().getIcon());
        m.put("objectTypeSvgIconUrl", obj.getObjectType().getSvgIconUrl());
        m.put("objectTypePropertySchema", obj.getObjectType().getPropertySchema());
        m.put("properties", obj.getProperties());
        return m;
    }

    private Map<String, Object> toLinkMap(Link link) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", link.getId().toString());
        m.put("sourceId", link.getSource().getId().toString());
        m.put("sourceName", link.getSource().getDisplayName());
        m.put("sourceTypeName", link.getSource().getObjectType().getName());
        m.put("targetId", link.getTarget().getId().toString());
        m.put("targetName", link.getTarget().getDisplayName());
        m.put("targetTypeName", link.getTarget().getObjectType().getName());
        m.put("linkTypeName", link.getLinkType().getName());
        m.put("linkTypeDisplayName", link.getLinkType().getDisplayName());
        m.put("createdAt", link.getCreatedAt() != null ? link.getCreatedAt().toEpochMilli() : null);
        return m;
    }
}
