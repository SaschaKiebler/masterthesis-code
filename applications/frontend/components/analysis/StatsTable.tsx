"use client";

import useSWR from "swr";
import type { ChartDefinition } from "@/lib/api/analysis";
import type { TimeRange } from "@/lib/api/types";

interface StatsTableProps {
    chart: ChartDefinition;
    timeRange: TimeRange;
}

interface MetricStats {
    metric_point_id: string;
    display_name: string | null;
    unit: string | null;
    count: number;
    mean: number;
    median: number;
    std: number;
    min: number;
    max: number;
    q25: number;
    q75: number;
    iqr: number;
}

interface DescriptiveResponse {
    metrics: MetricStats[];
}

async function fetchDescriptive(metricPointIds: string[], timeRange: TimeRange): Promise<DescriptiveResponse> {
    const resp = await fetch("/api/analytics/stats/descriptive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            metric_point_ids: metricPointIds,
            time_range: { start: timeRange.from, end: timeRange.to },
        }),
    });
    if (!resp.ok) throw new Error("Failed to fetch descriptive stats");
    return resp.json();
}

function fmt(v: number): string {
    return v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function StatsTable({ chart, timeRange }: StatsTableProps) {
    const metricPointIds = chart.sources.map((s) => s.metricPointId).filter(Boolean) as string[];

    const { data } = useSWR(
        metricPointIds.length > 0 ? ["descriptive", metricPointIds.join(","), timeRange.from, timeRange.to] : null,
        () => fetchDescriptive(metricPointIds, timeRange),
        { revalidateOnFocus: false, keepPreviousData: true },
    );

    if (metricPointIds.length === 0) {
        return (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                Add sensors to see statistics
            </div>
        );
    }

    if (!data) {
        return (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm animate-pulse">
                Computing statistics...
            </div>
        );
    }

    return (
        <div className="overflow-auto h-full p-3">
            <table className="w-full text-sm">
                <thead>
                    <tr className="text-left text-muted-foreground border-b border-input">
                        <th className="pb-2 pr-4 font-medium">Metric</th>
                        <th className="pb-2 pr-3 font-medium text-right">Count</th>
                        <th className="pb-2 pr-3 font-medium text-right">Mean</th>
                        <th className="pb-2 pr-3 font-medium text-right">Median</th>
                        <th className="pb-2 pr-3 font-medium text-right">Std</th>
                        <th className="pb-2 pr-3 font-medium text-right">Min</th>
                        <th className="pb-2 pr-3 font-medium text-right">Q25</th>
                        <th className="pb-2 pr-3 font-medium text-right">Q75</th>
                        <th className="pb-2 pr-3 font-medium text-right">Max</th>
                        <th className="pb-2 font-medium text-right">IQR</th>
                    </tr>
                </thead>
                <tbody>
                    {data.metrics.map((m) => {
                        const src = chart.sources.find((s) => s.metricPointId === m.metric_point_id);
                        return (
                            <tr key={m.metric_point_id} className="border-b border-input/50">
                                <td className="py-2 pr-4 flex items-center gap-2">
                                    <span
                                        className="w-2.5 h-2.5 rounded-full shrink-0"
                                        style={{ backgroundColor: src?.color || "#888" }}
                                    />
                                    <span className="text-foreground">{m.display_name || src?.label || "—"}</span>
                                    <span className="text-muted-foreground text-xs">{m.unit || ""}</span>
                                </td>
                                <td className="py-2 pr-3 text-right font-mono text-foreground">{m.count.toLocaleString()}</td>
                                <td className="py-2 pr-3 text-right font-mono text-foreground">{fmt(m.mean)}</td>
                                <td className="py-2 pr-3 text-right font-mono text-foreground">{fmt(m.median)}</td>
                                <td className="py-2 pr-3 text-right font-mono text-muted-foreground">{fmt(m.std)}</td>
                                <td className="py-2 pr-3 text-right font-mono text-foreground">{fmt(m.min)}</td>
                                <td className="py-2 pr-3 text-right font-mono text-muted-foreground">{fmt(m.q25)}</td>
                                <td className="py-2 pr-3 text-right font-mono text-muted-foreground">{fmt(m.q75)}</td>
                                <td className="py-2 pr-3 text-right font-mono text-foreground">{fmt(m.max)}</td>
                                <td className="py-2 text-right font-mono text-muted-foreground">{fmt(m.iqr)}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
