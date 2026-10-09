package com.heatingplatform.core.fleet;

import com.heatingplatform.core.fleet.FleetSiteHealthDTO;
import com.heatingplatform.core.fleet.FleetStatusDTO;
import com.heatingplatform.core.ontology.ObjectEntity;
import com.heatingplatform.core.ontology.ObjectRepository;
import com.heatingplatform.core.user.AuthService;
import com.heatingplatform.core.fleet.FleetService;
import com.heatingplatform.core.ontology.OntologyService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;
import java.util.stream.Collectors;

/**
 * Fleet overview endpoint for consultants and system admins.
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/fleet")
@RequiredArgsConstructor
public class FleetController {

    private final FleetService fleetService;
    private final AuthService authService;
    private final ObjectRepository objectRepository;

    @GetMapping("/status")
    public ResponseEntity<Map<String, Object>> getFleetStatus() {
        log.info("REST GET /api/v1/fleet/status");

        if (!authService.isConsultantOrAdmin()) {
            return ResponseEntity.status(403)
                .body(Map.of("message", "Fleet view requires consultant or system_admin role"));
        }

        try {
            List<ObjectEntity> sites;
            if (authService.isSystemAdmin()) {
                sites = objectRepository.findAllWithTenantByObjectTypeName(OntologyService.BUILDING);
            } else {
                List<UUID> tenantIds = authService.getAccessibleTenantIds();
                if (tenantIds.isEmpty()) {
                    sites = List.of();
                } else {
                    sites = objectRepository.findByTenantIdsWithTenantAndObjectTypeName(tenantIds, OntologyService.BUILDING);
                }
            }

            FleetStatusDTO fleetStatus = fleetService.getFleetStatus(sites);

            List<Map<String, Object>> siteMaps = fleetStatus.sites().stream()
                .map(this::toSiteMap)
                .collect(Collectors.toList());

            FleetStatusDTO.FleetSummary summary = fleetStatus.summary();
            Map<String, Object> summaryMap = new LinkedHashMap<>();
            summaryMap.put("totalSites", summary.totalSites());
            summaryMap.put("totalAssets", summary.totalAssets());
            summaryMap.put("totalTenants", summary.totalTenants());
            summaryMap.put("healthyCount", summary.healthyCount());
            summaryMap.put("warningCount", summary.warningCount());
            summaryMap.put("criticalCount", summary.criticalCount());
            summaryMap.put("offlineCount", summary.offlineCount());

            Map<String, Object> response = new LinkedHashMap<>();
            response.put("sites", siteMaps);
            response.put("summary", summaryMap);

            return ResponseEntity.ok(response);
        } catch (Exception e) {
            log.error("Error computing fleet status: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError()
                .body(Map.of("message", "Failed to compute fleet status"));
        }
    }

    private Map<String, Object> toSiteMap(FleetSiteHealthDTO dto) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("id", dto.id().toString());
        map.put("name", dto.name());
        map.put("address", dto.address());
        map.put("tenantId", dto.tenantId().toString());
        map.put("tenantName", dto.tenantName());
        map.put("latitude", dto.latitude());
        map.put("longitude", dto.longitude());
        map.put("assetCount", dto.assetCount());

        Map<String, Object> health = new LinkedHashMap<>();
        health.put("status", dto.status());
        health.put("onlineAssets", dto.onlineAssets());
        health.put("offlineAssets", dto.offlineAssets());
        health.put("staleSensors", dto.staleSensors());
        health.put("lastDataReceived", dto.lastDataReceived() != null
            ? dto.lastDataReceived().getEpochSecond() : null);

        map.put("health", health);
        return map;
    }
}
