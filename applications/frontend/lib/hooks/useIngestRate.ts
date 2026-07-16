"use client";

/**
 * Ingest Rate Hook
 * Live measurement throughput for a project (measurements per minute and
 * actively sending devices), from the analytics service. Drives the live
 * stats row on the project Monitor.
 */

import useSWR from "swr";
import { fetchIngestRate } from "../api/analytics-client";
import { useProjectMetricPointIds } from "./useProjectMetricPointIds";

export function useIngestRate(projectId: string | null, windowMinutes = 15) {
    const { ids: metricPointIds } = useProjectMetricPointIds(projectId);

    const { data, error, isLoading } = useSWR(
        projectId && metricPointIds.length > 0
            ? `analytics-ingest-rate:${projectId}:${metricPointIds.length}:${windowMinutes}`
            : null,
        () => fetchIngestRate(metricPointIds, windowMinutes),
        {
            refreshInterval: 10_000,
            revalidateOnFocus: false,
            dedupingInterval: 5_000,
        }
    );

    return {
        rate: data ?? null,
        isLoading,
        isError: error,
    };
}
