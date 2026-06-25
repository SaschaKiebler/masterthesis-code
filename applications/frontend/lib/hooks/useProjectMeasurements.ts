/**
 * SWR Hook — Project-Scoped Measurements (ADR-013 C.5)
 *
 * Replaces useGraphMeasurements which fetched per-building via
 * getSiteMeasurements (broken: relied on REALIZED_BY → physical_devices chain).
 *
 * This hook fetches via the project-scoped measurements endpoint which resolves
 * through HAS_METRIC → metric_points → device_id (the working ADR-013 path).
 *
 * Also computes statistics client-side from the returned measurements.
 */

import useSWR from "swr";
import { getProjectMeasurements } from "../api/projects";
import type { Measurement, MeasurementStatistic, TimeRange } from "../api/types";

function computeStatistics(measurements: Measurement[]): MeasurementStatistic[] {
    const groups = new Map<string, Measurement[]>();
    for (const m of measurements) {
        const key = `${m.deviceId}:${m.metricId}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(m);
    }

    return Array.from(groups.entries()).map(([, ms]) => {
        const values = ms.map((m) => m.value);
        const n = values.length;
        const sum = values.reduce((a, b) => a + b, 0);
        const avg = sum / n;
        const variance = values.reduce((a, v) => a + (v - avg) ** 2, 0) / n;
        return {
            deviceId: ms[0].deviceId,
            metricId: ms[0].metricId,
            metricName: ms[0].metricName,
            min: Math.min(...values),
            max: Math.max(...values),
            avg,
            stddev: Math.sqrt(variance),
            sampleCount: n,
        };
    });
}

export function useProjectMeasurements(
    projectId: string,
    allMetricPointIds: string[],
    timeRange: TimeRange | undefined,
    live = false,
    bucketOverride: number | null = null
) {
    const idsKey = allMetricPointIds.slice().sort().join(",");

    const key =
        projectId && idsKey.length > 0 && timeRange
            ? ["project-measurements", projectId, idsKey, timeRange.from, timeRange.to, bucketOverride]
            : null;

    const { data, isLoading, error } = useSWR<{
        measurements: Measurement[];
        statistics: MeasurementStatistic[];
        bucketMinutes: number;
    }>(
        key,
        async () => {
            const resp = await getProjectMeasurements(projectId, {
                metricPointIds: idsKey,
                from: timeRange!.from,
                to: timeRange!.to,
                ...(bucketOverride !== null ? { bucket: bucketOverride } : {}),
            });

            const measurements = resp.measurements;
            const statistics = computeStatistics(measurements);

            return {
                measurements,
                statistics,
                bucketMinutes: resp.bucketMinutes,
            };
        },
        {
            revalidateOnFocus: false,
            revalidateOnReconnect: true,
            refreshInterval: live ? 30000 : 0,
            keepPreviousData: true,
        }
    );

    return {
        allMeasurements: data?.measurements ?? [],
        allStatistics: data?.statistics ?? [],
        bucketMinutes: data?.bucketMinutes ?? 0,
        isLoading: isLoading && !data,
        isError: error,
    };
}
