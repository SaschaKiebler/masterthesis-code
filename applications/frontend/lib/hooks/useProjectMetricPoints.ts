/**
 * SWR Hook — Project-Level Metric Points (ADR-013)
 * Fetches MetricPoint objects for all assets in a project in parallel.
 * Returns Map<assetId, MetricPoint[]> for use with buildSeriesMapFromGraph.
 */

import useSWR from "swr";
import { getMetricPoints } from "../api/metric-points";
import type { MetricPoint } from "../api/metric-points";

export function useProjectMetricPoints(assets: Array<{ id: string }>) {
    // Stable key — sorted asset IDs joined as string
    const assetIds = assets.map((a) => a.id).sort().join(",");

    const { data, isLoading, error } = useSWR<Map<string, MetricPoint[]>>(
        assetIds.length > 0 ? ["project-metric-points", assetIds] : null,
        async () => {
            const results = await Promise.all(
                assets.map((a) => getMetricPoints(a.id).catch(() => [] as MetricPoint[]))
            );
            const mp = new Map<string, MetricPoint[]>();
            assets.forEach((a, i) => mp.set(a.id, results[i]));
            return mp;
        },
        {
            revalidateOnFocus: false,
            revalidateOnReconnect: false,
            keepPreviousData: true,
        }
    );

    return {
        metricPointsByAsset: data ?? new Map<string, MetricPoint[]>(),
        isLoading: isLoading && !data,
        isError: error,
    };
}
