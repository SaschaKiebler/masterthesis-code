/**
 * Dashboard Health Hook
 * Computes per-site health status from measurement freshness.
 * Used by landlord and technician dashboards where the fleet API is not available.
 *
 * Health classification (matches fleet status backend logic):
 *   healthy  — data received within last 2 hours
 *   warning  — data received 2–24 hours ago
 *   critical — data received >24 hours ago
 *   no_data  — no measurements found (or site has 0 assets)
 */

import { useMemo } from "react";
import useSWR from "swr";
import { getSiteMeasurements } from "../api/sites";
import type { SiteSummary } from "../api/types";

export type SiteHealthStatus = "healthy" | "warning" | "critical" | "no_data";

export interface SiteHealthInfo {
    siteId: string;
    status: SiteHealthStatus;
    lastDataReceived: number | null;
}

export interface HealthSummary {
    healthyCount: number;
    warningCount: number;
    criticalCount: number;
    noDataCount: number;
    siteHealth: Record<string, SiteHealthInfo>;
}

const TWO_HOURS_S = 2 * 60 * 60;
const TWENTY_FOUR_HOURS_S = 24 * 60 * 60;

function classifyFreshness(latestTimestamp: number | null, nowS: number): SiteHealthStatus {
    if (latestTimestamp === null) return "no_data";
    const age = nowS - latestTimestamp;
    if (age < TWO_HOURS_S) return "healthy";
    if (age < TWENTY_FOUR_HOURS_S) return "warning";
    return "critical";
}

async function computeSiteHealth(sites: SiteSummary[]): Promise<HealthSummary> {
    const nowS = Math.floor(Date.now() / 1000);
    const from24h = nowS - TWENTY_FOUR_HOURS_S;

    const results = await Promise.allSettled(
        sites.map(async (site): Promise<SiteHealthInfo> => {
            if (site.assetCount === 0) {
                return { siteId: site.id, status: "no_data", lastDataReceived: null };
            }

            try {
                const data = await getSiteMeasurements(
                    site.id,
                    { from: from24h, to: nowS },
                    120 // 2-hour buckets → max 12 rows per device, lightweight
                );

                if (data.measurements.length === 0) {
                    return { siteId: site.id, status: "critical", lastDataReceived: null };
                }

                const latestTime = Math.max(...data.measurements.map((m) => m.time));
                const status = classifyFreshness(latestTime, nowS);
                return { siteId: site.id, status, lastDataReceived: latestTime };
            } catch {
                return { siteId: site.id, status: "no_data", lastDataReceived: null };
            }
        })
    );

    const siteHealth: Record<string, SiteHealthInfo> = {};
    let healthyCount = 0;
    let warningCount = 0;
    let criticalCount = 0;
    let noDataCount = 0;

    for (const result of results) {
        if (result.status === "fulfilled") {
            const info = result.value;
            siteHealth[info.siteId] = info;
            switch (info.status) {
                case "healthy":
                    healthyCount++;
                    break;
                case "warning":
                    warningCount++;
                    break;
                case "critical":
                    criticalCount++;
                    break;
                case "no_data":
                    noDataCount++;
                    break;
            }
        }
    }

    return { healthyCount, warningCount, criticalCount, noDataCount, siteHealth };
}

/**
 * Hook to compute dashboard health from measurement freshness.
 * Fetches site-level measurements for each site to determine data flow status.
 * Suitable for dashboards with a small number of sites (landlord, technician).
 */
export function useDashboardHealth(sites: SiteSummary[]) {
    const cacheKey = useMemo(
        () =>
            sites.length > 0
                ? `dashboard-health:${sites.map((s) => s.id).sort().join(",")}`
                : null,
        [sites]
    );

    const { data, error, isLoading } = useSWR<HealthSummary>(
        cacheKey,
        () => computeSiteHealth(sites),
        {
            refreshInterval: 120_000,
            revalidateOnFocus: true,
            dedupingInterval: 30_000,
        }
    );

    return {
        health: data ?? null,
        isLoading,
        isError: error,
    };
}
