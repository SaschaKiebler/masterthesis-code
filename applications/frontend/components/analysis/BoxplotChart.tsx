"use client";

import { useMemo } from "react";
import useSWR from "swr";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { BoxplotChart as EBoxplotChart, ScatterChart } from "echarts/charts";
import {
    GridComponent,
    TooltipComponent,
    LegendComponent,
    ToolboxComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { MarkLineComponent } from "echarts/components";
import type { ChartDefinition } from "@/lib/api/analysis";
import type { TimeRange } from "@/lib/api/types";
import { useChartCalculations } from "@/lib/hooks/useChartCalculations";

echarts.use([EBoxplotChart, ScatterChart, GridComponent, TooltipComponent, LegendComponent, ToolboxComponent, MarkLineComponent, CanvasRenderer]);

interface BoxplotChartProps {
    chart: ChartDefinition;
    timeRange: TimeRange;
}

interface BoxplotData {
    categories: string[];
    series: {
        metric_point_id: string;
        display_name: string | null;
        unit: string | null;
        boxplot_data: number[][];
        outliers: number[][];
    }[];
}

async function fetchBoxplot(
    metricPointIds: string[],
    timeRange: TimeRange,
    groupBy: string,
): Promise<BoxplotData> {
    const resp = await fetch("/api/analytics/stats/boxplot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            metric_point_ids: metricPointIds,
            time_range: { start: timeRange.from, end: timeRange.to },
            group_by: groupBy,
        }),
    });
    if (!resp.ok) throw new Error("Failed to fetch boxplot");
    return resp.json();
}

export function BoxplotChart({ chart, timeRange }: BoxplotChartProps) {
    const computedSeries = useChartCalculations(chart, timeRange);
    const metricPointIds = chart.sources.map((s) => s.metricPointId).filter(Boolean) as string[];
    const groupBy = chart.display.groupBy || "weekday";

    const { data } = useSWR(
        metricPointIds.length > 0 && timeRange
            ? ["boxplot", metricPointIds.join(","), timeRange.from, timeRange.to, groupBy]
            : null,
        () => fetchBoxplot(metricPointIds, timeRange, groupBy),
        { revalidateOnFocus: false, keepPreviousData: true },
    );

    const option = useMemo(() => {
        if (!data || data.series.length === 0) return null;

        const allSeries: any[] = [];
        for (const s of data.series) {
            allSeries.push({
                name: s.display_name || s.metric_point_id,
                type: "boxplot",
                data: s.boxplot_data,
                itemStyle: { borderColor: chart.sources.find((src) => src.metricPointId === s.metric_point_id)?.color || "#3b82f6" },
            });
            if (s.outliers.length > 0) {
                allSeries.push({
                    name: `${s.display_name || ""} outliers`,
                    type: "scatter",
                    data: s.outliers,
                    itemStyle: {
                        color: chart.sources.find((src) => src.metricPointId === s.metric_point_id)?.color || "#ef4444",
                        opacity: 0.6,
                    },
                    symbolSize: 4,
                });
            }
        }

        // Add computed marklines (mean, median, reference)
        // Colors come from the chart definition — the computed response may be stale
        const calcColorById = new Map(chart.calculations.map((c) => [c.id, c.color]));
        for (const cs of computedSeries) {
            const liveColor = calcColorById.get(cs.id) ?? cs.color;
            if (cs.type === "markline" && cs.mark_value != null && allSeries.length > 0) {
                if (!allSeries[0].markLine) {
                    allSeries[0].markLine = { silent: true, symbol: "none", data: [] };
                }
                allSeries[0].markLine.data.push({
                    yAxis: cs.mark_value,
                    label: { formatter: `${cs.label}: ${cs.mark_value}`, position: "end", color: liveColor },
                    lineStyle: { color: liveColor, type: "dashed", width: 1.5 },
                });
            }
        }

        return {
            animation: false,
            grid: { left: 60, right: 20, top: 20, bottom: 40 },
            tooltip: { trigger: "item" },
            xAxis: {
                type: "category",
                data: data.categories,
                axisLabel: { color: "#888" },
            },
            yAxis: {
                type: "value",
                name: data.series[0]?.unit || "",
                nameTextStyle: { color: "#888" },
                axisLabel: { color: "#888" },
                splitLine: { lineStyle: { color: "rgba(128,128,128,0.15)" } },
            },
            toolbox: {
                right: 10, top: 5,
                feature: { saveAsImage: { pixelRatio: 2, title: "PNG" } },
            },
            series: allSeries,
        };
    }, [data, chart.sources, chart.calculations, computedSeries]);

    if (metricPointIds.length === 0) {
        return (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                Add sensors to see boxplot
            </div>
        );
    }

    if (!option) {
        return (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm animate-pulse">
                Computing boxplot...
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
