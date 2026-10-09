package com.heatingplatform.core.common;

import com.heatingplatform.core.tenancy.TenantBodyGuard;
import com.heatingplatform.core.tenancy.ResourceKind;
import com.heatingplatform.core.tenancy.CrossTenantAccessException;
import com.heatingplatform.core.site.SiteDTO;
import com.heatingplatform.core.ontology.ObjectEntity;
import com.heatingplatform.core.proto.v1.*;
import com.heatingplatform.core.proto.v1.UUID;
import com.heatingplatform.core.ontology.ObjectRepository;
import com.heatingplatform.core.asset.AssetService;
import com.heatingplatform.core.user.AuthService;
import com.heatingplatform.core.ontology.OntologyService;
import com.heatingplatform.core.site.SiteService;
import com.heatingplatform.core.asset.AssetDTO;
import com.heatingplatform.core.common.exception.ResourceNotFoundException;
import com.heatingplatform.core.common.exception.ValidationException;
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
    private final TenantBodyGuard tenantBodyGuard;

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

    // Site-Level Channel Endpoint (resolve-then-fetch: the BFF composes
    // series/statistics from these channels and the analytics service)

    @GetMapping("/sites/{siteId}/channels")
    public ResponseEntity<Map<String, Object>> getSiteChannels(@PathVariable String siteId) {
        log.info("REST GET /api/v1/sites/{}/channels", siteId);
        try {
            java.util.UUID siteUuid = java.util.UUID.fromString(siteId);
            List<Map<String, Object>> channels = assetServiceBean.resolveSiteChannels(siteUuid)
                .stream().map(RestGateway::channelDto).collect(Collectors.toList());
            return ResponseEntity.ok(Map.of("channels", channels, "count", channels.size()));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        } catch (Exception e) {
            log.error("Error resolving site channels for {}: {}", siteId, e.getMessage(), e);
            return ResponseEntity.internalServerError().body(Map.of("message", "Failed to resolve site channels"));
        }
    }

    private static Map<String, Object> channelDto(com.heatingplatform.core.measurement.ChannelResolver.Channel c) {
        Map<String, Object> dto = new HashMap<>();
        dto.put("metricPointId", c.metricPointId().toString());
        dto.put("deviceId", c.deviceId());
        dto.put("metricId", c.metricId());
        dto.put("metricName", c.displayName());
        dto.put("unit", c.unit());
        dto.put("source", c.source());
        return dto;
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

    @GetMapping("/assets/{id}/channels")
    public ResponseEntity<Map<String, Object>> getAssetChannels(
            @PathVariable String id,
            @RequestParam(required = false) String metrics) {
        log.info("REST GET /api/v1/assets/{}/channels", id);
        try {
            java.util.UUID assetId = java.util.UUID.fromString(id);
            List<String> metricNames = null;
            if (metrics != null && !metrics.isBlank()) {
                metricNames = java.util.Arrays.stream(metrics.split(","))
                    .map(String::trim).filter(m -> !m.isEmpty()).toList();
            }
            return assetServiceBean.getChannels(assetId, metricNames)
                .map(channels -> {
                    Map<String, Object> body = new HashMap<>();
                    body.put("channels", channels.stream().map(RestGateway::channelDto).collect(Collectors.toList()));
                    return ResponseEntity.ok(body);
                })
                .orElseGet(() -> ResponseEntity.status(404).body(Map.of("message", "Asset not found")));
        } catch (Exception e) {
            log.error("Error resolving asset channels for {}: {}", id, e.getMessage(), e);
            return ResponseEntity.internalServerError().body(Map.of("message", "Failed to resolve asset channels"));
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

            // The destination comes from the body: without this an asset could
            // be moved into another tenant's site.
            tenantBodyGuard.requireAccess(ResourceKind.OBJECT, targetSiteId);
            tenantBodyGuard.requireAccess(ResourceKind.OBJECT, targetSpaceId);

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
        } catch (CrossTenantAccessException e) {
            throw e; // 403 via the global handler, not a 500 from the catch-all below
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
