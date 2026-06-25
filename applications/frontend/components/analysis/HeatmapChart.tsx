"use client";

import { useMemo } from "react";
import useSWR from "swr";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { HeatmapChart as EHeatmapChart } from "echarts/charts";
import {
    GridComponent,
    TooltipComponent,
    VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { ChartDefinition } from "@/lib/api/analysis";
import type { TimeRange } from "@/lib/api/types";

echarts.use([EHeatmapChart, GridComponent, TooltipComponent, VisualMapComponent, CanvasRenderer]);

interface HeatmapChartProps {
    chart: ChartDefinition;
    timeRange: TimeRange;
}

interface HeatmapData {
    x_labels: string[];
    y_labels: string[];
    data: (number | null)[][];
    min_value: number | null;
    max_value: number | null;
    display_name: string | null;
    unit: string | null;
}

async function fetchHeatmap(metricPointId: string, timeRange: TimeRange): Promise<HeatmapData> {
    const resp = await fetch("/api/analytics/stats/heatmap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            metric_point_id: metricPointId,
            time_range: { start: timeRange.from, end: timeRange.to },
        }),
    });
    if (!resp.ok) throw new Error("Failed to fetch heatmap");
    return resp.json();
}

export function HeatmapChart({ chart, timeRange }: HeatmapChartProps) {
    const firstSource = chart.sources[0];
    const mpId = firstSource?.metricPointId;

    const { data } = useSWR(
        mpId ? ["heatmap", mpId, timeRange.from, timeRange.to] : null,
        () => fetchHeatmap(mpId!, timeRange),
        { revalidateOnFocus: false, keepPreviousData: true },
    );

    const option = useMemo(() => {
        if (!data || data.data.length === 0) return null;

        return {
            animation: false,
            grid: { left: 50, right: 80, top: 10, bottom: 40 },
            tooltip: {
                formatter: (p: any) => {
                    if (p.data[2] == null) return "";
                    return `${data.y_labels[p.data[1]]} ${data.x_labels[p.data[0]]}:00<br/><b>${p.data[2]} ${data.unit || ""}</b>`;
                },
            },
            xAxis: {
                type: "category",
                data: data.x_labels,
                axisLabel: { color: "#888" },
                splitArea: { show: true },
            },
            yAxis: {
                type: "category",
                data: data.y_labels,
                axisLabel: { color: "#888" },
                splitArea: { show: true },
            },
            visualMap: {
                min: data.min_value ?? 0,
                max: data.max_value ?? 100,
                calculable: true,
                orient: "vertical",
                right: 10,
                top: "center",
                inRange: {
                    color: ["#313695", "#4575b4", "#74add1", "#abd9e9", "#fee090", "#fdae61", "#f46d43", "#d73027"],
                },
                textStyle: { color: "#888" },
            },
            series: [{
                type: "heatmap",
                data: data.data.filter((d) => d[2] != null),
                emphasis: { itemStyle: { shadowBlur: 10, shadowColor: "rgba(0,0,0,0.5)" } },
            }],
        };
    }, [data]);

    if (!mpId) {
        return (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                Add a sensor to see heatmap (hour × weekday)
            </div>
        );
    }

    if (!option) {
        return (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm animate-pulse">
                Computing heatmap...
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
