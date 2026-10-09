package com.heatingplatform.core.fleet;

import java.time.Instant;
import java.util.UUID;

/**
 * Health-enriched site summary for the Fleet overview.
 * Combines ontology data (site + tenant) with telemetry freshness.
 */
public record FleetSiteHealthDTO(
    UUID id,
    String name,
    String address,
    UUID tenantId,
    String tenantName,
    Double latitude,
    Double longitude,
    int assetCount,
    int onlineAssets,
    int offlineAssets,
    int staleSensors,
    Instant lastDataReceived,
    String status  // "healthy", "warning", "critical", "offline"
) {}
