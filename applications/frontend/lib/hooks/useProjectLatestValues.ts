"use client";

/**
 * Project Latest Values Hook
 * Fetches the most recent measurement for every metric point in a project.
 * Used by the synoptic view to overlay live values on graph nodes.
 */

import { useMemo } from "react";
import useSWR from "swr";
import { getProjectLatestValues, type LatestValue } from "../api/projects";

/** Latest values indexed by asset object ID for quick lookup */
export interface LatestValuesByObject {
    /** objectId → array of latest values for that object's metric points */
    [objectId: string]: LatestValue[];
}

export function useProjectLatestValues(projectId: string | null) {
    const { data, error, isLoading } = useSWR(
        projectId ? `project-latest-values:${projectId}` : null,
        () => getProjectLatestValues(projectId!),
        {
            refreshInterval: 10_000, // 10s for live data
            revalidateOnFocus: false,
            dedupingInterval: 5_000,
        }
    );

    // Index values by asset object ID for O(1) lookup in the graph
    const byObject = useMemo<LatestValuesByObject>(() => {
        if (!data?.values) return {};
        const map: LatestValuesByObject = {};
        for (const v of data.values) {
            if (v.assetObjectId) {
                if (!map[v.assetObjectId]) map[v.assetObjectId] = [];
                map[v.assetObjectId].push(v);
            }
        }
        return map;
    }, [data]);

    return {
        values: data?.values ?? [],
        byObject,
        isLoading,
        isError: error,
    };
}
