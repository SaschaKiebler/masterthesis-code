package com.digitaldemon.core.fleet;

import com.digitaldemon.core.ontology.OntologyService;

import com.digitaldemon.core.fleet.FleetSiteHealthDTO;
import com.digitaldemon.core.fleet.FleetStatusDTO;
import com.digitaldemon.core.ontology.ObjectEntity;
import com.digitaldemon.core.measurement.ChannelResolver;
import com.digitaldemon.core.measurement.LatestValueProjection;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Fleet overview service for consultants and system admins.
 * Aggregates site health status from telemetry freshness data.
 */
@Slf4j
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class FleetService {

    private final ChannelResolver channelResolver;
    private final LatestValueProjection latestValueProjection;
    private final OntologyService ontologyService;

    /** Site membership from the graph, last-seen from the in-memory projection. */
    record DeviceLastSeen(UUID siteId, String deviceId, Instant lastTime) {
    }

    public static final Duration ONLINE_THRESHOLD = Duration.ofHours(2);
    public static final Duration STALE_THRESHOLD = Duration.ofHours(2);
    public static final Duration OFFLINE_THRESHOLD = Duration.ofHours(24);
    static final Duration SITE_OFFLINE_THRESHOLD = Duration.ofHours(48);

    /**
     * Compute fleet status for all sites visible to the caller.
     *
     * @param sites pre-filtered list of BUILDING objects the caller can access
     */
    public FleetStatusDTO getFleetStatus(List<ObjectEntity> sites) {
        log.debug("Computing fleet status for {} sites", sites.size());
        Instant now = Instant.now();

        List<UUID> siteIds = sites.stream().map(ObjectEntity::getId).toList();
        Map<UUID, List<DeviceLastSeen>> lastSeenBySite =
            channelResolver.devicesBySites(siteIds).stream()
                .map(d -> new DeviceLastSeen(d.siteId(), d.deviceId(),
                        latestValueProjection.lastSeen(d.deviceId()).orElse(null)))
                .collect(Collectors.groupingBy(DeviceLastSeen::siteId));

        List<FleetSiteHealthDTO> healthDTOs = new ArrayList<>();
        int totalAssets = 0;
        int healthyCount = 0;
        int warningCount = 0;
        int criticalCount = 0;
        int offlineCount = 0;
        Set<UUID> tenantIds = new HashSet<>();

        for (ObjectEntity site : sites) {
            UUID tenantId = site.getTenant().getId();
            String tenantName = site.getTenant().getName();
            tenantIds.add(tenantId);

            List<DeviceLastSeen> deviceData =
                lastSeenBySite.getOrDefault(site.getId(), List.of());

            int assetCount = ontologyService.countByTargetAndType(site.getId(), OntologyService.INSTALLED_AT);
            totalAssets += assetCount;

            int online = 0;
            int stale = 0;
            int offline = 0;
            Instant latestData = null;

            for (DeviceLastSeen d : deviceData) {
                if (d.lastTime() != null) {
                    if (latestData == null || d.lastTime().isAfter(latestData)) {
                        latestData = d.lastTime();
                    }
                    Duration age = Duration.between(d.lastTime(), now);
                    if (age.compareTo(ONLINE_THRESHOLD) <= 0) {
                        online++;
                    } else if (age.compareTo(OFFLINE_THRESHOLD) <= 0) {
                        stale++;
                    } else {
                        offline++;
                    }
                } else {
                    offline++;
                }
            }

            int devicesWithData = deviceData.size();
            int devicesWithoutData = Math.max(0, assetCount - devicesWithData);
            offline += devicesWithoutData;

            String status = computeSiteStatus(assetCount, online, stale, offline, latestData, now);

            // Extract lat/lng from properties -> attributes
            Double latitude = null;
            Double longitude = null;
            try {
                String attrs = OntologyService.extractProperty(site.getProperties(), "attributes");
                if (attrs != null && attrs.contains("\"latitude\"")) {
                    latitude = extractJsonDouble(attrs, "latitude");
                    longitude = extractJsonDouble(attrs, "longitude");
                }
            } catch (Exception e) {
                log.trace("Could not parse lat/lng from site {} properties: {}", site.getId(), e.getMessage());
            }

            String address = OntologyService.extractProperty(site.getProperties(), "address");

            FleetSiteHealthDTO dto = new FleetSiteHealthDTO(
                site.getId(),
                site.getDisplayName(),
                address != null ? address : "",
                tenantId,
                tenantName,
                latitude,
                longitude,
                assetCount,
                online,
                offline,
                stale,
                latestData,
                status
            );
            healthDTOs.add(dto);

            switch (status) {
                case "healthy" -> healthyCount++;
                case "warning" -> warningCount++;
                case "critical" -> criticalCount++;
                case "offline" -> offlineCount++;
            }
        }

        healthDTOs.sort(Comparator
            .comparingInt((FleetSiteHealthDTO h) -> statusPriority(h.status()))
            .thenComparing(FleetSiteHealthDTO::name));

        FleetStatusDTO.FleetSummary summary = new FleetStatusDTO.FleetSummary(
            sites.size(),
            totalAssets,
            tenantIds.size(),
            healthyCount,
            warningCount,
            criticalCount,
            offlineCount
        );

        return new FleetStatusDTO(healthDTOs, summary);
    }

    public String computeSiteStatus(int assetCount, int online, int stale, int offline,
                             Instant lastDataReceived, Instant now) {
        if (assetCount == 0) {
            return "healthy";
        }
        if (lastDataReceived == null) {
            return "offline";
        }
        Duration sinceLastData = Duration.between(lastDataReceived, now);
        if (sinceLastData.compareTo(SITE_OFFLINE_THRESHOLD) > 0) {
            return "offline";
        }
        if (offline > 0) {
            return "critical";
        }
        if (stale > 0) {
            return "warning";
        }
        return "healthy";
    }

    private static int statusPriority(String status) {
        return switch (status) {
            case "critical" -> 0;
            case "warning" -> 1;
            case "offline" -> 2;
            case "healthy" -> 3;
            default -> 4;
        };
    }

    public static Double extractJsonDouble(String json, String key) {
        if (json == null) return null;
        String search = "\"" + key + "\"";
        int idx = json.indexOf(search);
        if (idx < 0) return null;

        int colonIdx = json.indexOf(':', idx + search.length());
        if (colonIdx < 0) return null;

        int numStart = colonIdx + 1;
        while (numStart < json.length() && (json.charAt(numStart) == ' ' || json.charAt(numStart) == '\t')) {
            numStart++;
        }
        if (numStart >= json.length()) return null;

        int numEnd = numStart;
        while (numEnd < json.length() && (Character.isDigit(json.charAt(numEnd))
                || json.charAt(numEnd) == '.' || json.charAt(numEnd) == '-' || json.charAt(numEnd) == '+')) {
            numEnd++;
        }
        if (numEnd == numStart) return null;

        try {
            return Double.parseDouble(json.substring(numStart, numEnd));
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
