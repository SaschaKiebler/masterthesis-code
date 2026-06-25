/**
 * Asset API Service
 * Handles all asset-related API calls
 */

import { apiFetch, buildQueryString } from "./client";
import type {
    GetAssetResponse,
    GetMeasurementsResponse,
    GetLatestMeasurementsResponse,
    TimeRange,
} from "./types";

/**
 * Get asset details
 */
export async function getAsset(assetId: string): Promise<GetAssetResponse> {
    return apiFetch<GetAssetResponse>(`/assets/${assetId}`);
}

/**
 * Get time-series measurements with aggregation
 */
export async function getMeasurements(
    assetId: string,
    timeRange?: TimeRange,
    bucketMinutes: number = 60,
    metrics?: string[]
): Promise<GetMeasurementsResponse> {
    const params: Record<string, any> = { bucketMinutes };

    if (timeRange) {
        params.from = timeRange.from;
        params.to = timeRange.to;
    }

    if (metrics && metrics.length > 0) {
        params.metrics = metrics.join(",");
    }

    const queryString = buildQueryString(params);
    return apiFetch<GetMeasurementsResponse>(`/assets/${assetId}/measurements${queryString}`);
}

/**
 * Get latest measurements (one per metric)
 */
export async function getLatestMeasurements(
    assetId: string,
    metrics?: string[]
): Promise<GetLatestMeasurementsResponse> {
    const params: Record<string, any> = {};
    if (metrics && metrics.length > 0) {
        params.metrics = metrics.join(",");
    }
    const queryString = buildQueryString(params);
    return apiFetch<GetLatestMeasurementsResponse>(`/assets/${assetId}/measurements/latest${queryString}`);
}

/**
 * Update asset properties (name, type). Partial update — only provided fields are applied.
 */
export async function updateAsset(
    assetId: string,
    updates: { name?: string; type?: string }
): Promise<GetAssetResponse> {
    return apiFetch<GetAssetResponse>(`/assets/${assetId}`, {
        method: "PATCH",
        body: JSON.stringify(updates),
    });
}

/**
 * Relocate an asset to a different site and optionally a space within that site.
 * Telemetry data follows automatically (keyed by immutable device_id).
 */
export async function relocateAsset(
    assetId: string,
    targetSiteId: string,
    targetSpaceId?: string | null
): Promise<GetAssetResponse> {
    return apiFetch<GetAssetResponse>(`/assets/${assetId}/relocate`, {
        method: "POST",
        body: JSON.stringify({
            targetSiteId,
            targetSpaceId: targetSpaceId || null,
        }),
    });
}
