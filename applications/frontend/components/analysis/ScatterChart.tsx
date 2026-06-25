"use client";

import { useMemo } from "react";
import useSWR from "swr";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { ScatterChart as EScatterChart, LineChart } from "echarts/charts";
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

echarts.use([EScatterChart, LineChart, GridComponent, TooltipComponent, LegendComponent, ToolboxComponent, MarkLineComponent, CanvasRenderer]);

interface ScatterChartProps {
    chart: ChartDefinition;
    timeRange: TimeRange;
}

interface RegressionData {
    scatter: number[][];
    regression_line: number[][];
    r_squared: number;
    slope: number;
    intercept: number;
    n_points: number;
    x_label: string | null;
    y_label: string | null;
    confidence_band: { x: number[]; y_lower: number[]; y_upper: number[] } | null;
}

async function fetchRegression(xId: string, yId: string, timeRange: TimeRange): Promise<RegressionData> {
    const resp = await fetch("/api/analytics/stats/regression", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            x_metric_point_id: xId,
            y_metric_point_id: yId,
            time_range: { start: timeRange.from, end: timeRange.to },
        }),
    });
    if (!resp.ok) throw new Error("Failed to fetch regression");
    return resp.json();
}

export function ScatterChart({ chart, timeRange }: ScatterChartProps) {
    const computedSeries = useChartCalculations(chart, timeRange);
    const xSource = chart.sources.find((s) => s.id === chart.display.xSource) || chart.sources[0];
    const ySource = chart.sources.find((s) => s.id === chart.display.ySource) || chart.sources[1];

    const { data } = useSWR(
        xSource?.metricPointId && ySource?.metricPointId && timeRange
            ? ["scatter-regression", xSource.metricPointId, ySource.metricPointId, timeRange.from, timeRange.to]
            : null,
        () => fetchRegression(xSource!.metricPointId!, ySource!.metricPointId!, timeRange),
        { revalidateOnFocus: false, keepPreviousData: true },
    );

    const option = useMemo(() => {
        if (!data || data.scatter.length === 0) return null;

        const series: any[] = [
            {
                name: "Data",
                type: "scatter",
                data: data.scatter,
                itemStyle: { color: xSource?.color || "#3b82f6", opacity: 0.6 },
                symbolSize: 5,
            },
        ];

        if (data.regression_line.length === 2) {
            series.push({
                name: `R²=${data.r_squared}`,
                type: "line",
                data: data.regression_line,
                lineStyle: { color: "#ef4444", width: 2 },
                symbol: "none",
                smooth: false,
            });
        }

        if (data.confidence_band) {
            const bandData = data.confidence_band.x.map((x, i) => [x, data.confidence_band!.y_lower[i], data.confidence_band!.y_upper[i]]);
            series.push({
                name: "95% CI",
                type: "line",
                data: bandData.map(([x, low]) => [x, low]),
                lineStyle: { opacity: 0 },
                symbol: "none",
                areaStyle: { opacity: 0 },
                stack: "ci",
            });
            series.push({
                name: "95% CI upper",
                type: "line",
                data: bandData.map(([x, low, high]) => [x, high - low]),
                lineStyle: { opacity: 0 },
                symbol: "none",
                areaStyle: { color: "#ef444420", opacity: 1 },
                stack: "ci",
            });
        }

        // Add computed calculation series (marklines, trend lines, etc.)
        // Colors come from the chart definition — the computed response may be stale
        const calcColorById = new Map(chart.calculations.map((c) => [c.id, c.color]));
        for (const cs of computedSeries) {
            const liveColor = calcColorById.get(cs.id) ?? cs.color;
            if (cs.type === "markline" && cs.mark_value != null) {
                if (series.length > 0 && !series[0].markLine) {
                    series[0].markLine = { silent: true, symbol: "none", data: [] };
                }
                if (series.length > 0) {
                    series[0].markLine.data.push({
                        yAxis: cs.mark_value,
                        label: { formatter: `${cs.label}: ${cs.mark_value}`, position: "end", color: liveColor },
                        lineStyle: { color: liveColor, type: "dashed", width: 1.5 },
                    });
                }
            } else if (cs.type === "line" && cs.data.length > 0) {
                series.push({
                    name: cs.label,
                    type: "line",
                    data: cs.data,
                    lineStyle: { color: liveColor, width: 2, type: "dashed" },
                    symbol: "none",
                    smooth: false,
                });
            }
        }

        return {
            animation: false,
            grid: { left: 60, right: 20, top: 40, bottom: 40 },
            tooltip: {
                trigger: "item",
                formatter: (p: any) => {
                    if (p.seriesType === "scatter") {
                        return `${data.x_label || "X"}: <b>${p.data[0]}</b><br/>${data.y_label || "Y"}: <b>${p.data[1]}</b>`;
                    }
                    return "";
                },
            },
            legend: {
                bottom: 0,
                textStyle: { color: "#888" },
            },
            xAxis: {
                type: "value",
                name: data.x_label || xSource?.label || "X",
                nameTextStyle: { color: "#888" },
                axisLabel: { color: "#888" },
                splitLine: { lineStyle: { color: "rgba(128,128,128,0.15)" } },
            },
            yAxis: {
                type: "value",
                name: data.y_label || ySource?.label || "Y",
                nameTextStyle: { color: "#888" },
                axisLabel: { color: "#888" },
                splitLine: { lineStyle: { color: "rgba(128,128,128,0.15)" } },
            },
            toolbox: {
                right: 10, top: 5,
                feature: { saveAsImage: { pixelRatio: 2, title: "PNG" } },
            },
            series,
        };
    }, [data, xSource, ySource, computedSeries, chart.calculations]);

    if (!xSource?.metricPointId || !ySource?.metricPointId) {
        return (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                Scatter needs at least 2 sensors — first = X axis, second = Y axis
            </div>
        );
    }

    if (!option) {
        return (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm animate-pulse">
                Computing regression...
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
