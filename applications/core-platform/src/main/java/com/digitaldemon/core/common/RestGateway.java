package com.digitaldemon.core.common;

import com.digitaldemon.core.site.SiteDTO;
import com.digitaldemon.core.measurement.MeasurementStatisticsDTO;
import com.digitaldemon.core.ontology.ObjectEntity;
import com.digitaldemon.core.proto.v1.*;
import com.digitaldemon.core.proto.v1.UUID;
import com.digitaldemon.core.ontology.ObjectRepository;
import com.digitaldemon.core.asset.AssetService;
import com.digitaldemon.core.user.AuthService;
import com.digitaldemon.core.ontology.OntologyService;
import com.digitaldemon.core.site.SiteService;
import com.digitaldemon.core.asset.AssetDTO;
import com.digitaldemon.core.common.exception.ResourceNotFoundException;
import com.digitaldemon.core.common.exception.ValidationException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;
import java.util.stream.Collectors;

/**
 * REST Gateway that provides HTTP/JSON API by calling gRPC services internally.
 */
@Slf4j
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class RestGateway {

    private final AssetServiceGrpc.AssetServiceBlockingStub assetServiceStub;
    private final AuthService authService;
    private final SiteService siteService;
    private final AssetService assetServiceBean;
    private final ObjectRepository objectRepository;

    // Site Endpoints

    @GetMapping("/sites")
    public ResponseEntity<Map<String, Object>> listSites(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "100") int pageSize,
            @RequestParam(required = false) String tenantId) {

        log.info("REST GET /api/v1/sites (tenantId={})", tenantId);

        List<SiteDTO> siteDTOs;

        if (tenantId != null && !tenantId.isBlank()) {
            java.util.UUID tid = java.util.UUID.fromString(tenantId);
            if (!authService.canAccessTenant(tid)) {
                return ResponseEntity.status(403).body(Map.of("message", "Access denied to tenant"));
            }
            siteDTOs = siteService.getSitesByTenant(tid);
        } else if (authService.isSystemAdmin()) {
            siteDTOs = siteService.getAllSites();
        } else {
            List<java.util.UUID> accessibleSiteIds = authService.getAccessibleSiteIds();
            if (accessibleSiteIds == null) {
                siteDTOs = siteService.getAllSites();
            } else {
                siteDTOs = siteService.getSitesBySiteIds(accessibleSiteIds);
            }
        }

        List<Map<String, Object>> sites = siteDTOs.stream()
            .map(site -> {
                Map<String, Object> siteMap = new HashMap<>();
                siteMap.put("id", site.id().toString());
                siteMap.put("name", site.name());
                siteMap.put("address", site.address());
                siteMap.put("assetCount", site.assetCount());
                return siteMap;
            })
            .collect(Collectors.toList());

        return ResponseEntity.ok(Map.of(
            "sites", sites,
            "page", Map.of(
                "totalItems", sites.size(),
                "totalPages", 1,
                "currentPage", 1,
                "pageSize", sites.size()
            )
        ));
    }

    @GetMapping("/sites/{id}")
    public ResponseEntity<Map<String, Object>> getSite(@PathVariable String id) {
        log.info("REST GET /api/v1/sites/{}", id);

        java.util.UUID siteUuid;
        try {
            siteUuid = java.util.UUID.fromString(id);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("message", "Invalid site ID: " + id));
        }

        ObjectEntity obj = objectRepository.findById(siteUuid).orElse(null);
        if (obj == null) {
            return ResponseEntity.status(404).body(Map.of("message", "Site not found: " + id));
        }

        String address = OntologyService.extractProperty(obj.getProperties(), "address");

        Map<String, Object> site = new HashMap<>();
        site.put("id", id);
        site.put("name", obj.getDisplayName() != null ? obj.getDisplayName() : "");
        site.put("address", address != null ? address : "");
        site.put("tenantId", obj.getTenant() != null ? obj.getTenant().getId().toString() : "");

        List<AssetDTO> assetDTOs = assetServiceBean.getAssetsBySite(siteUuid);
        List<Map<String, Object>> assets = assetDTOs.stream()
            .map(asset -> {
                Map<String, Object> assetMap = new HashMap<>();
                assetMap.put("id", asset.id().toString());
                assetMap.put("name", asset.name());
                assetMap.put("spaceId", asset.spaceId() != null ? asset.spaceId().toString() : null);
                assetMap.put("specs", asset.specs());
                return assetMap;
            })
            .collect(Collectors.toList());

        return ResponseEntity.ok(Map.of(
            "site", site,
            "assets", assets
        ));
    }

    // Site-Level Measurement Endpoints

    @GetMapping("/sites/{siteId}/measurements")
    public ResponseEntity<Map<String, Object>> getSiteMeasurements(
            @PathVariable String siteId,
            @RequestParam(required = false) Long from,
            @RequestParam(required = false) Long to,
            @RequestParam(required = false) Integer bucketMinutes) {

        log.info("REST GET /api/v1/sites/{}/measurements (from={}, to={}, bucket={})", siteId, from, to, bucketMinutes);

        try {
            java.util.UUID siteUuid = java.util.UUID.fromString(siteId);

            java.time.Instant fromInstant = from != null ? java.time.Instant.ofEpochSecond(from) : null;
            java.time.Instant toInstant = to != null ? java.time.Instant.ofEpochSecond(to) : null;

            AssetService.SiteMeasurementsResult result = assetServiceBean.getSiteMeasurements(
                siteUuid, fromInstant, toInstant, bucketMinutes);

            List<Map<String, Object>> measurements = result.measurements().stream()
                .map(m -> {
                    Map<String, Object> mm = new HashMap<>();
                    mm.put("time", m.time().getEpochSecond());
                    mm.put("deviceId", m.deviceId());
                    mm.put("metricId", m.metricId());
                    mm.put("metricName", m.metricName());
                    mm.put("value", m.value());
                    return mm;
                })
                .collect(Collectors.toList());

            Map<String, Object> response = new HashMap<>();
            response.put("measurements", measurements);
            response.put("bucketMinutes", result.bucketMinutes());
            response.put("count", measurements.size());

            return ResponseEntity.ok(response);
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        } catch (Exception e) {
            log.error("Error fetching site measurements for {}: {}", siteId, e.getMessage(), e);
            return ResponseEntity.internalServerError().body(Map.of("message", "Failed to fetch site measurements"));
        }
    }

    @GetMapping("/sites/{siteId}/measurements/statistics")
    public ResponseEntity<Map<String, Object>> getSiteStatistics(
            @PathVariable String siteId,
            @RequestParam(required = false) Long from,
            @RequestParam(required = false) Long to) {

        log.info("REST GET /api/v1/sites/{}/measurements/statistics (from={}, to={})", siteId, from, to);

        try {
            java.util.UUID siteUuid = java.util.UUID.fromString(siteId);

            java.time.Instant fromInstant = from != null ? java.time.Instant.ofEpochSecond(from) : null;
            java.time.Instant toInstant = to != null ? java.time.Instant.ofEpochSecond(to) : null;

            List<MeasurementStatisticsDTO> stats = assetServiceBean.getSiteStatistics(
                siteUuid, fromInstant, toInstant);

            List<Map<String, Object>> statistics = stats.stream()
                .map(s -> {
                    Map<String, Object> sm = new HashMap<>();
                    sm.put("deviceId", s.deviceId());
                    sm.put("metricId", s.metricId());
                    sm.put("metricName", s.metricName());
                    sm.put("min", s.min());
                    sm.put("max", s.max());
                    sm.put("avg", s.avg());
                    sm.put("stddev", s.stddev());
                    sm.put("sampleCount", s.sampleCount());
                    return sm;
                })
                .collect(Collectors.toList());

            return ResponseEntity.ok(Map.of("statistics", statistics));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        } catch (Exception e) {
            log.error("Error fetching site statistics for {}: {}", siteId, e.getMessage(), e);
            return ResponseEntity.internalServerError().body(Map.of("message", "Failed to fetch site statistics"));
        }
    }

    // Asset Endpoints

    @GetMapping("/assets/{id}")
    public ResponseEntity<Map<String, Object>> getAsset(@PathVariable String id) {
        log.info("REST GET /api/v1/assets/{}", id);

        GetAssetRequest request = GetAssetRequest.newBuilder()
            .setAssetId(UUID.newBuilder().setValue(id).build())
            .build();

        GetAssetResponse response = assetServiceStub.getAsset(request);
        Asset asset = response.getAsset();

        Map<String, Object> assetMap = new HashMap<>();
        assetMap.put("id", asset.getId().getValue());
        assetMap.put("deviceId", asset.getDeviceId());
        assetMap.put("siteId", asset.hasSiteId() ? asset.getSiteId().getValue() : null);
        assetMap.put("spaceId", asset.hasSpaceId() ? asset.getSpaceId().getValue() : null);
        assetMap.put("name", asset.getName());
        assetMap.put("type", asset.getType());
        assetMap.put("modelHuman", asset.getModelHuman());
        assetMap.put("signalMap", Map.of("json", asset.getSignalMap().getJson()));
        assetMap.put("specs", asset.hasSpecs() ? Map.of("json", asset.getSpecs().getJson()) : null);

        return ResponseEntity.ok(Map.of("asset", assetMap));
    }

    @GetMapping("/assets/{id}/measurements")
    public ResponseEntity<Map<String, Object>> getMeasurements(
            @PathVariable String id,
            @RequestParam(required = false) Long from,
            @RequestParam(required = false) Long to,
            @RequestParam(defaultValue = "60") int bucketMinutes,
            @RequestParam(required = false) String metrics) {

        log.info("REST GET /api/v1/assets/{}/measurements", id);

        try {
            GetMeasurementsRequest.Builder requestBuilder = GetMeasurementsRequest.newBuilder()
                .setAssetId(UUID.newBuilder().setValue(id).build())
                .setBucketMinutes(bucketMinutes);

            if (from != null || to != null) {
                TimeRange.Builder timeRangeBuilder = TimeRange.newBuilder();
                if (from != null) {
                    timeRangeBuilder.setFrom(com.google.protobuf.Timestamp.newBuilder()
                        .setSeconds(from)
                        .build());
                }
                if (to != null) {
                    timeRangeBuilder.setTo(com.google.protobuf.Timestamp.newBuilder()
                        .setSeconds(to)
                        .build());
                }
                requestBuilder.setTimeRange(timeRangeBuilder.build());
            }

            if (metrics != null && !metrics.isBlank()) {
                for (String name : metrics.split(",")) {
                    String trimmed = name.trim();
                    if (!trimmed.isEmpty()) {
                        requestBuilder.addMetricNames(trimmed);
                    }
                }
            }

            GetMeasurementsResponse response = assetServiceStub.getMeasurements(requestBuilder.build());

            List<Map<String, Object>> measurements = response.getMeasurementsList().stream()
                .map(m -> {
                    Map<String, Object> measurementMap = new HashMap<>();
                    measurementMap.put("time", m.getTime().getSeconds());
                    measurementMap.put("deviceId", m.getDeviceId());
                    measurementMap.put("metricId", m.getMetricId());
                    measurementMap.put("metricName", m.getMetricName());
                    measurementMap.put("value", m.getValue());
                    return measurementMap;
                })
                .collect(Collectors.toList());

            return ResponseEntity.ok(Map.of("measurements", measurements));
        } catch (io.grpc.StatusRuntimeException e) {
            log.error("gRPC error fetching measurements for asset {}: {} - {}", id, e.getStatus(), e.getMessage());
            return ResponseEntity.status(mapGrpcStatus(e.getStatus().getCode())).body(Map.of("measurements", List.of()));
        }
    }

    @GetMapping("/assets/{id}/measurements/latest")
    public ResponseEntity<Map<String, Object>> getLatestMeasurements(
            @PathVariable String id,
            @RequestParam(required = false) String metrics) {
        log.info("REST GET /api/v1/assets/{}/measurements/latest", id);

        try {
            GetLatestMeasurementsRequest.Builder requestBuilder = GetLatestMeasurementsRequest.newBuilder()
                .setAssetId(UUID.newBuilder().setValue(id).build());

            if (metrics != null && !metrics.isBlank()) {
                for (String name : metrics.split(",")) {
                    String trimmed = name.trim();
                    if (!trimmed.isEmpty()) {
                        requestBuilder.addMetricNames(trimmed);
                    }
                }
            }

            GetLatestMeasurementsRequest request = requestBuilder.build();

            GetLatestMeasurementsResponse response = assetServiceStub.getLatestMeasurements(request);

            List<Map<String, Object>> measurements = response.getMeasurementsList().stream()
                .map(m -> {
                    Map<String, Object> measurementMap = new HashMap<>();
                    measurementMap.put("time", m.getTime().getSeconds());
                    measurementMap.put("deviceId", m.getDeviceId());
                    measurementMap.put("metricId", m.getMetricId());
                    measurementMap.put("metricName", m.getMetricName());
                    measurementMap.put("value", m.getValue());
                    return measurementMap;
                })
                .collect(Collectors.toList());

            return ResponseEntity.ok(Map.of("measurements", measurements));
        } catch (io.grpc.StatusRuntimeException e) {
            log.error("gRPC error fetching latest measurements for asset {}: {} - {}", id, e.getStatus(), e.getMessage());
            return ResponseEntity.status(mapGrpcStatus(e.getStatus().getCode())).body(Map.of("measurements", List.of()));
        }
    }

    @PatchMapping("/assets/{id}")
    public ResponseEntity<Map<String, Object>> updateAsset(
            @PathVariable String id,
            @RequestBody Map<String, Object> body) {

        log.info("REST PATCH /api/v1/assets/{}", id);

        try {
            java.util.UUID assetId = java.util.UUID.fromString(id);
            String name = (String) body.get("name");
            String type = (String) body.get("type");

            AssetDTO updated = assetServiceBean.updateAsset(assetId, name, type);

            Map<String, Object> assetMap = new HashMap<>();
            assetMap.put("id", updated.id().toString());
            assetMap.put("siteId", updated.siteId() != null ? updated.siteId().toString() : null);
            assetMap.put("spaceId", updated.spaceId() != null ? updated.spaceId().toString() : null);
            assetMap.put("name", updated.name());
            assetMap.put("specs", updated.specs());

            return ResponseEntity.ok(Map.of("asset", assetMap));
        } catch (ValidationException e) {
            return ResponseEntity.badRequest().body(Map.of("message", e.getMessage()));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        } catch (Exception e) {
            log.error("Error updating asset {}: {}", id, e.getMessage(), e);
            return ResponseEntity.internalServerError().body(Map.of("message", "Failed to update asset"));
        }
    }

    @PostMapping("/assets/{id}/relocate")
    public ResponseEntity<Map<String, Object>> relocateAsset(
            @PathVariable String id,
            @RequestBody Map<String, Object> body) {

        log.info("REST POST /api/v1/assets/{}/relocate", id);

        try {
            java.util.UUID assetId = java.util.UUID.fromString(id);

            String targetSiteIdStr = (String) body.get("targetSiteId");
            if (targetSiteIdStr == null || targetSiteIdStr.isBlank()) {
                return ResponseEntity.badRequest().body(Map.of("message", "targetSiteId is required"));
            }
            java.util.UUID targetSiteId = java.util.UUID.fromString(targetSiteIdStr);

            String targetSpaceIdStr = (String) body.get("targetSpaceId");
            java.util.UUID targetSpaceId = (targetSpaceIdStr != null && !targetSpaceIdStr.isBlank())
                ? java.util.UUID.fromString(targetSpaceIdStr) : null;

            AssetDTO relocated = assetServiceBean.relocateAsset(assetId, targetSiteId, targetSpaceId);

            Map<String, Object> assetMap = new HashMap<>();
            assetMap.put("id", relocated.id().toString());
            assetMap.put("siteId", relocated.siteId() != null ? relocated.siteId().toString() : null);
            assetMap.put("spaceId", relocated.spaceId() != null ? relocated.spaceId().toString() : null);
            assetMap.put("name", relocated.name());
            assetMap.put("specs", relocated.specs());

            return ResponseEntity.ok(Map.of("asset", assetMap));
        } catch (ValidationException e) {
            return ResponseEntity.badRequest().body(Map.of("message", e.getMessage()));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("message", "Invalid UUID format"));
        } catch (Exception e) {
            log.error("Error relocating asset {}: {}", id, e.getMessage(), e);
            return ResponseEntity.internalServerError().body(Map.of("message", "Failed to relocate asset"));
        }
    }

    private int mapGrpcStatus(io.grpc.Status.Code code) {
        return switch (code) {
            case NOT_FOUND -> 404;
            case INVALID_ARGUMENT -> 400;
            case ALREADY_EXISTS -> 409;
            case PERMISSION_DENIED -> 403;
            case UNAUTHENTICATED -> 401;
            default -> 500;
        };
    }
}
