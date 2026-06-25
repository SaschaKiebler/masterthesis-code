/**
 * Site API Service
 * Handles all site-related API calls
 */

import { apiFetch, buildQueryString } from "./client";
import type {
    ListSitesResponse,
    GetSiteResponse,
    SiteMeasurementsResponse,
    SiteStatisticsResponse,
    TimeRange,
} from "./types";

/**
 * List all sites with pagination
 */
export async function listSites(
    page: number = 1,
    pageSize: number = 100,
    tenantId?: string
): Promise<ListSitesResponse> {
    const queryString = buildQueryString({ page, pageSize, tenantId });
    return apiFetch<ListSitesResponse>(`/sites${queryString}`);
}

/**
 * Get site details with all associated assets
 */
export async function getSite(siteId: string): Promise<GetSiteResponse> {
    return apiFetch<GetSiteResponse>(`/sites/${siteId}`);
}

/**
 * Get measurements for all assets of a site (consultant analysis view).
 * Smart downsampling: backend auto-calculates bucket size if not provided.
 */
export async function getSiteMeasurements(
    siteId: string,
    timeRange?: TimeRange,
    bucketMinutes?: number
): Promise<SiteMeasurementsResponse> {
    const params: Record<string, string | number> = {};
    if (timeRange?.from) params.from = timeRange.from;
    if (timeRange?.to) params.to = timeRange.to;
    if (bucketMinutes) params.bucketMinutes = bucketMinutes;
    const queryString = buildQueryString(params);
    return apiFetch<SiteMeasurementsResponse>(`/sites/${siteId}/measurements${queryString}`);
}

/**
 * Get statistics (min/max/avg/stddev/count) for all metrics of a site.
 */
export async function getSiteStatistics(
    siteId: string,
    timeRange?: TimeRange
): Promise<SiteStatisticsResponse> {
    const params: Record<string, string | number> = {};
    if (timeRange?.from) params.from = timeRange.from;
    if (timeRange?.to) params.to = timeRange.to;
    const queryString = buildQueryString(params);
    return apiFetch<SiteStatisticsResponse>(`/sites/${siteId}/measurements/statistics${queryString}`);
}
