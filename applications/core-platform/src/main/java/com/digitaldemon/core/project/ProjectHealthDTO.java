package com.digitaldemon.core.project;

import java.util.List;
import java.util.UUID;

/**
 * Project-scoped health overview with per-building device health details.
 * Used by the project overview tab to show device connectivity status.
 */
public record ProjectHealthDTO(
    List<BuildingHealth> buildings,
    Totals totals
) {
    public record DeviceHealth(
        UUID objectId,
        String deviceId,
        String displayName,
        String objectTypeName,
        String objectTypeCategory,
        String status,         // "online", "stale", "offline", "no_data"
        Long lastSeenEpoch     // epoch seconds, nullable
    ) {}

    public record BuildingHealth(
        UUID id,
        String name,
        String status,         // "healthy", "warning", "critical", "offline"
        List<DeviceHealth> devices,
        Summary summary
    ) {}

    public record Summary(int online, int stale, int offline, int noData) {}

    public record Totals(
        int buildings,
        int devices,
        int online,
        int stale,
        int offline
    ) {}
}
