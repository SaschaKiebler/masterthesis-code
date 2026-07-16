"use client";

/**
 * Project Metric-Point IDs Hook
 * Resolves the metric-point ids in a project's scope from core (structure).
 * Shared by the live hooks that then read values from the analytics service.
 * The SWR key is shared, so multiple consumers cause a single fetch.
 */

import { useMemo } from "react";
import useSWR from "swr";
import { getProjectMetricPoints } from "../api/projects";

export function useProjectMetricPointIds(projectId: string | null) {
    const { data, error, isLoading } = useSWR(
        projectId ? `project-metric-points:${projectId}` : null,
        () => getProjectMetricPoints(projectId!),
        {
            revalidateOnFocus: false,
            // Structure changes rarely; refresh occasionally so newly
            // commissioned devices appear without a reload.
            refreshInterval: 60_000,
        }
    );

    const ids = useMemo(
        () => data?.metricPoints.map((mp) => mp.id) ?? [],
        [data]
    );

    return { ids, metricPoints: data?.metricPoints ?? [], isLoading, isError: error };
}
