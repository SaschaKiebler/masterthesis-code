"use client";

import useSWR from "swr";
import type { ChartDefinition } from "@/lib/api/analysis";
import type { TimeRange } from "@/lib/api/types";

export interface ComputedSeries {
    id: string;
    label: string;
    color: string;
    type: "line" | "band" | "markers" | "markline";
    data: (number | null)[][];
    band_upper?: (number | null)[][] | null;
    mark_value?: number | null;
    extra?: Record<string, unknown> | null;
}

interface ComputeResponse {
    series: ComputedSeries[];
}

async function fetchCompute(
    chart: ChartDefinition,
    timeRange: TimeRange,
    bucketSeconds: number | null,
): Promise<ComputeResponse> {
    const resp = await fetch("/api/analytics/stats/compute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            sources: chart.sources
                .filter((s) => s.metricPointId)
                .map((s) => ({ id: s.id, metric_point_id: s.metricPointId })),
            calculations: chart.calculations,
            time_range: { start: timeRange.from, end: timeRange.to },
            ...(bucketSeconds !== null ? { bucket_seconds: bucketSeconds } : {}),
        }),
    });
    if (!resp.ok) return { series: [] };
    return resp.json();
}

export function useChartCalculations(
    chart: ChartDefinition,
    timeRange: TimeRange,
    bucketMinutes: number | null = null,
): ComputedSeries[] {
    const hasCalcs = chart.calculations.length > 0 && chart.sources.length > 0;
    // Inputs and params are part of the key so edits (e.g. formula text) refetch
    const calcsKey = chart.calculations
        .map((c) => `${c.id}:${c.type}:${JSON.stringify(c.inputs)}:${JSON.stringify(c.params ?? {})}`)
        .join(",");
    const sourcesKey = chart.sources.map((s) => s.metricPointId).join(",");

    // null = auto bucketing on the backend; "Raw" (0) aligns at 1min, the finest
    // resolution where timestamps from different sensors still match up
    const bucketSeconds = bucketMinutes === null ? null : Math.max(60, bucketMinutes * 60);

    const { data } = useSWR(
        hasCalcs ? ["compute", chart.id, calcsKey, sourcesKey, timeRange.from, timeRange.to, bucketSeconds] : null,
        () => fetchCompute(chart, timeRange, bucketSeconds),
        { revalidateOnFocus: false, keepPreviousData: true },
    );

    return data?.series ?? [];
}
