"use client";

import { useMemo } from "react";
import useSWR from "swr";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { BarChart } from "echarts/charts";
import {
    GridComponent,
    TooltipComponent,
    LegendComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { ChartDefinition } from "@/lib/api/analysis";
import type { TimeRange } from "@/lib/api/types";

echarts.use([BarChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

interface HistogramChartProps {
    chart: ChartDefinition;
    timeRange: TimeRange;
}

interface HistogramData {
    series: {
        metric_point_id: string;
        display_name: string | null;
        unit: string | null;
        bin_edges: number[];
        counts: number[];
    }[];
}

async function fetchHistogram(metricPointIds: string[], timeRange: TimeRange): Promise<HistogramData> {
    const resp = await fetch("/api/analytics/stats/histogram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            metric_point_ids: metricPointIds,
            time_range: { start: timeRange.from, end: timeRange.to },
            bins: 30,
        }),
    });
    if (!resp.ok) throw new Error("Failed to fetch histogram");
    return resp.json();
}

export function HistogramChart({ chart, timeRange }: HistogramChartProps) {
    const metricPointIds = chart.sources.map((s) => s.metricPointId).filter(Boolean) as string[];

    const { data } = useSWR(
        metricPointIds.length > 0 ? ["histogram", metricPointIds.join(","), timeRange.from, timeRange.to] : null,
        () => fetchHistogram(metricPointIds, timeRange),
        { revalidateOnFocus: false, keepPreviousData: true },
    );

    const option = useMemo(() => {
        if (!data || data.series.length === 0) return null;

        const allSeries: any[] = [];
        let categories: string[] = [];

        for (const s of data.series) {
            // Bin labels from edges: "10.0 – 12.5"
            if (categories.length === 0) {
                categories = s.bin_edges.slice(0, -1).map((edge, i) =>
                    `${edge.toFixed(1)}–${s.bin_edges[i + 1].toFixed(1)}`
                );
            }
            const color = chart.sources.find((src) => src.metricPointId === s.metric_point_id)?.color || "#3b82f6";
            allSeries.push({
                name: s.display_name || s.metric_point_id,
                type: "bar",
                data: s.counts,
                itemStyle: { color, opacity: 0.8 },
                barMaxWidth: 40,
            });
        }

        return {
            animation: false,
            grid: { left: 50, right: 20, top: 20, bottom: 60 },
            tooltip: { trigger: "axis" },
            legend: data.series.length > 1 ? { bottom: 0, textStyle: { color: "#888" } } : undefined,
            xAxis: {
                type: "category",
                data: categories,
                axisLabel: { color: "#888", rotate: 45, fontSize: 10 },
            },
            yAxis: {
                type: "value",
                name: "Count",
                nameTextStyle: { color: "#888" },
                axisLabel: { color: "#888" },
                splitLine: { lineStyle: { color: "rgba(128,128,128,0.15)" } },
            },
            series: allSeries,
        };
    }, [data, chart.sources]);

    if (metricPointIds.length === 0) {
        return (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                Add sensors to see histogram
            </div>
        );
    }

    if (!option) {
        return (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm animate-pulse">
                Computing histogram...
            </div>
        );
    }

    return (
        <ReactEChartsCore
            echarts={echarts}
            option={option}
            style={{ height: "100%", width: "100%" }}
            notMerge={true}
            lazyUpdate={true}
        />
    );
}
