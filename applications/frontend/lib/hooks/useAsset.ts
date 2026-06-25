/**
 * SWR Hook for Assets
 * Provides data fetching with automatic caching and revalidation
 */

import useSWR from "swr";
import { getAsset, getMeasurements, getLatestMeasurements } from "../api/assets";
import type {
    GetAssetResponse,
    GetMeasurementsResponse,
    GetLatestMeasurementsResponse,
    TimeRange,
} from "../api/types";

/**
 * Hook to fetch asset details
 */
export function useAsset(assetId: string | null) {
    const { data, error, isLoading, mutate } = useSWR<GetAssetResponse>(
        assetId ? `/assets/${assetId}` : null,
        assetId ? () => getAsset(assetId) : null,
        {
            revalidateOnFocus: false,
            revalidateOnReconnect: true,
        }
    );

    return {
        asset: data?.asset,
        isLoading,
        isError: error,
        mutate,
    };
}

/**
 * Hook to fetch asset measurements
 */
export function useMeasurements(
    assetId: string | null,
    timeRange?: TimeRange,
    bucketMinutes: number = 60,
    metrics?: string[]
) {
    const metricsKey = metrics?.length ? metrics.join(",") : "";
    const key = assetId
        ? `/assets/${assetId}/measurements?from=${timeRange?.from || ""}&to=${timeRange?.to || ""}&bucket=${bucketMinutes}&metrics=${metricsKey}`
        : null;

    const { data, error, isLoading, mutate } = useSWR<GetMeasurementsResponse>(
        key,
        assetId ? () => getMeasurements(assetId, timeRange, bucketMinutes, metrics) : null,
        {
            revalidateOnFocus: false,
            revalidateOnReconnect: true,
            refreshInterval: 30000, // Refresh every 30 seconds for live data
            keepPreviousData: true, // Keep showing old chart while revalidating
        }
    );

    return {
        measurements: data?.measurements || [],
        isLoading: isLoading && !data, // Only true on first load, not revalidation
        isError: error,
        mutate,
    };
}

/**
 * Hook to fetch latest measurements
 */
export function useLatestMeasurements(assetId: string | null, metrics?: string[]) {
    const metricsKey = metrics?.length ? metrics.join(",") : "";
    const key = assetId
        ? `/assets/${assetId}/measurements/latest?metrics=${metricsKey}`
        : null;

    const { data, error, isLoading, mutate } = useSWR<GetLatestMeasurementsResponse>(
        key,
        assetId ? () => getLatestMeasurements(assetId, metrics) : null,
        {
            revalidateOnFocus: false,
            revalidateOnReconnect: true,
            refreshInterval: 10000, // Refresh every 10 seconds for latest data
        }
    );

    return {
        measurements: data?.measurements || [],
        isLoading,
        isError: error,
        mutate,
    };
}
