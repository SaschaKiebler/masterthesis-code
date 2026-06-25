package com.digitaldemon.core.fleet;

import java.util.List;

/**
 * Aggregate fleet status response for the Fleet overview page.
 * Contains per-site health data and a cross-fleet summary.
 */
public record FleetStatusDTO(
    List<FleetSiteHealthDTO> sites,
    FleetSummary summary
) {
    /**
     * Aggregate counts across the entire fleet.
     */
    public record FleetSummary(
        int totalSites,
        int totalAssets,
        int totalTenants,
        int healthyCount,
        int warningCount,
        int criticalCount,
        int offlineCount
    ) {}
}
