/**
 * SWR Hooks for Site-Level Measurements
 * Used by the consultant analysis view to fetch measurements and statistics
 * for all assets of a site in a single request.
 */

import useSWR from "swr";
import { getSiteMeasurements, getSiteStatistics } from "../api/sites";
import type {
    SiteMeasurementsResponse,
    SiteStatisticsResponse,
    TimeRange,
} from "../api/types";

/**
 * Hook to fetch measurements for all assets of a site.
 * Supports live mode via refreshInterval.
 */
export function useSiteMeasurements(
    siteId: string | null,
    timeRange?: TimeRange,
    bucketMinutes?: number,
    live: boolean = false
) {
    const key = siteId
        ? `/sites/${siteId}/measurements?from=${timeRange?.from || ""}&to=${timeRange?.to || ""}&bucket=${bucketMinutes || "auto"}`
        : null;

    const { data, error, isLoading, mutate } = useSWR<SiteMeasurementsResponse>(
        key,
        siteId ? () => getSiteMeasurements(siteId, timeRange, bucketMinutes) : null,
        {
            revalidateOnFocus: false,
            revalidateOnReconnect: true,
            refreshInterval: live ? 30000 : 0,
            keepPreviousData: true,
        }
    );

    return {
        measurements: data?.measurements || [],
        bucketMinutes: data?.bucketMinutes || bucketMinutes || 0,
        count: data?.count || 0,
        isLoading: isLoading && !data,
        isError: error,
        mutate,
    };
}

/**
 * Hook to fetch statistics for all metrics of a site.
 */
export function useSiteStatistics(
    siteId: string | null,
    timeRange?: TimeRange
) {
    const key = siteId
        ? `/sites/${siteId}/measurements/statistics?from=${timeRange?.from || ""}&to=${timeRange?.to || ""}`
        : null;

    const { data, error, isLoading, mutate } = useSWR<SiteStatisticsResponse>(
        key,
        siteId ? () => getSiteStatistics(siteId, timeRange) : null,
        {
            revalidateOnFocus: false,
            revalidateOnReconnect: true,
            keepPreviousData: true,
        }
    );

    return {
        statistics: data?.statistics || [],
        isLoading: isLoading && !data,
        isError: error,
        mutate,
    };
}
