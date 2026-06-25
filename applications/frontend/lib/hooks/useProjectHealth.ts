"use client";

/**
 * Project Health Hook
 * Fetches device-level health per building from the project health endpoint.
 * Used by the project overview tab to show device connectivity status.
 */

import useSWR from "swr";
import { getProjectHealth, type ProjectHealthResponse } from "../api/projects";

export function useProjectHealth(projectId: string | null) {
    const { data, error, isLoading } = useSWR<ProjectHealthResponse>(
        projectId ? `project-health:${projectId}` : null,
        () => getProjectHealth(projectId!),
        {
            refreshInterval: 120_000, // 2 min, matches useDashboardHealth
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
