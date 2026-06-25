"use client";

import { useMemo } from "react";
import type { Measurement, TimeRange } from "@/lib/api/types";
import type { ChartDefinition, ChartSource } from "@/lib/api/analysis";
import type { ProjectMetricPoint } from "@/lib/api/projects";
import { useChartCalculations } from "@/lib/hooks/useChartCalculations";

import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import {
    GridComponent,
    TooltipComponent,
    LegendComponent,
    DataZoomComponent,
    ToolboxComponent,
    MarkLineComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, ToolboxComponent, MarkLineComponent, CanvasRenderer]);

interface TimeSeriesChartProps {
    chart: ChartDefinition;
    measurements: Measurement[];
    metricPoints: ProjectMetricPoint[];
    timeRange: TimeRange;
    compareRange?: TimeRange | null;
    compareMeasurements?: Measurement[];
    bucketMinutes?: number | null;
}

export function TimeSeriesChart({ chart, measurements, metricPoints, timeRange, compareRange, compareMeasurements, bucketMinutes = null }: TimeSeriesChartProps) {
    const computedSeries = useChartCalculations(chart, timeRange, bucketMinutes);

    const option = useMemo(() => {
        if (chart.sources.length === 0) return null;

        const mpMap = new Map<string, ProjectMetricPoint>();
        for (const src of chart.sources) {
            if (src.metricPointId) {
                const mp = metricPoints.find((m) => m.id === src.metricPointId);
                if (mp) mpMap.set(src.metricPointId, mp);
            }
        }

        // Group measurements by source
        const seriesDataMap = new Map<string, [number, number][]>();
        for (const src of chart.sources) {
            seriesDataMap.set(src.id, []);
        }
        for (const m of measurements) {
            for (const src of chart.sources) {
                if (!src.metricPointId) continue;
                const mp = mpMap.get(src.metricPointId);
                if (mp && mp.deviceId === m.deviceId && mp.metricId === m.metricId) {
                    seriesDataMap.get(src.id)?.push([m.time * 1000, m.value]);
                    break;
                }
            }
        }

        // Y-axes
        const yAxes = chart.display.yAxes.map((axis) => ({
            type: "value" as const,
            name: axis.label || axis.unit,
            position: axis.position,
            axisLabel: { formatter: `{value} ${axis.unit}` },
            splitLine: { lineStyle: { color: "rgba(128,128,128,0.15)" } },
            nameTextStyle: { color: "#888" },
            axisLine: { show: false },
        }));

        // A formula calculation with "showOnly" replaces the sensor lines entirely
        const formulaOnly = chart.calculations.some(
            (c) => c.type === "formula" && Boolean((c.params as Record<string, unknown> | undefined)?.showOnly)
        );
        const calcById = new Map(chart.calculations.map((c) => [c.id, c]));

        // Source series
        const allSeries: any[] = formulaOnly ? [] : chart.sources.map((src) => ({
            name: src.label,
            type: "line",
            yAxisIndex: src.yAxisIndex || 0,
            data: seriesDataMap.get(src.id) || [],
            itemStyle: { color: src.color },
            lineStyle: { color: src.color, width: 2 },
            showSymbol: false,
            smooth: false,
        }));

        // Add computed calculation series
        const computed = computedSeries;
        for (const cs of computed) {
            // The chart definition is the source of truth for colors — the computed
            // response may carry a stale color (color edits don't trigger a recompute)
            const liveColor = calcById.get(cs.id)?.color ?? cs.color;
            if (cs.type === "line" && cs.data.length > 0) {
                const isFormula = calcById.get(cs.id)?.type === "formula";
                allSeries.push({
                    name: cs.label,
                    type: "line",
                    data: cs.data,
                    itemStyle: { color: liveColor },
                    lineStyle: { color: liveColor, width: 2, type: isFormula && formulaOnly ? "solid" : "dashed" },
                    showSymbol: false,
                    smooth: true,
                });
            } else if (cs.type === "markline" && cs.mark_value != null) {
                // Add markLine to the first source series
                if (allSeries.length > 0 && !allSeries[0].markLine) {
                    allSeries[0].markLine = { silent: true, symbol: "none", data: [] };
                }
                if (allSeries.length > 0) {
                    allSeries[0].markLine.data.push({
                        yAxis: cs.mark_value,
                        label: {
                            formatter: `${cs.label}: ${cs.mark_value}`,
                            position: "end",
                            color: liveColor,
                        },
                        lineStyle: { color: liveColor, type: "dashed", width: 1.5 },
                    });
                }
            } else if (cs.type === "band" && cs.data.length > 0 && cs.band_upper) {
                // Lower bound (invisible line)
                allSeries.push({
                    name: cs.label + " lower",
                    type: "line",
                    data: cs.data,
                    lineStyle: { opacity: 0 },
                    showSymbol: false,
                    stack: `band-${cs.id}`,
                    areaStyle: { opacity: 0 },
                });
                // Upper bound (filled area between lower and upper)
                const bandData = cs.band_upper.map((upper, i) => {
                    const lower = cs.data[i];
                    if (!upper || !lower || upper[1] == null || lower[1] == null) return [upper?.[0], 0];
                    return [upper[0], upper[1] - lower[1]];
                });
                allSeries.push({
                    name: cs.label,
                    type: "line",
                    data: bandData,
                    lineStyle: { opacity: 0 },
                    showSymbol: false,
                    stack: `band-${cs.id}`,
                    areaStyle: { color: liveColor, opacity: 0.15 },
                });
            }
        }

        // Compare series: shift timestamps so they overlay on the primary range
        if (!formulaOnly && compareRange && compareMeasurements && compareMeasurements.length > 0) {
            const timeShift = (timeRange.from - compareRange.from) * 1000; // ms

            for (const src of chart.sources) {
                if (!src.metricPointId) continue;
                const mp = mpMap.get(src.metricPointId);
                if (!mp) continue;

                const compareData: [number, number][] = [];
                for (const m of compareMeasurements) {
                    if (mp.deviceId === m.deviceId && mp.metricId === m.metricId) {
                        compareData.push([m.time * 1000 + timeShift, m.value]);
                    }
                }

                if (compareData.length > 0) {
                    allSeries.push({
                        name: `${src.label} (compare)`,
                        type: "line",
                        yAxisIndex: src.yAxisIndex || 0,
                        data: compareData,
                        itemStyle: { color: src.color },
                        lineStyle: { color: src.color, width: 1.5, type: "dashed", opacity: 0.6 },
                        showSymbol: false,
                        smooth: false,
                    });
                }
            }
        }

        const legendData = [
            ...(formulaOnly ? [] : chart.sources.map((s) => s.label)),
            ...(!formulaOnly && compareRange ? chart.sources.map((s) => `${s.label} (compare)`) : []),
            ...computed.filter((cs) => cs.type === "line" || cs.type === "band").map((cs) => cs.label),
        ];

        return {
            animation: false,
            grid: { left: 60, right: yAxes.length > 1 ? 60 : 20, top: 40, bottom: chart.display.showDataZoom ? 70 : 30 },
            tooltip: {
                trigger: "axis",
                axisPointer: { type: "cross" },
                formatter: (params: any) => {
                    if (!Array.isArray(params) || params.length === 0) return "";
                    const time = new Date(params[0].data[0]);
                    const timeStr = time.toLocaleString("de-DE", {
                        day: "2-digit", month: "2-digit",
                        hour: "2-digit", minute: "2-digit",
                    });
                    const lines = params
                        .filter((p: any) => p.data[1] != null && !p.seriesName.endsWith(" lower"))
                        .map((p: any) => {
                            const val = typeof p.data[1] === "number" ? p.data[1].toFixed(2) : "–";
                            return `<span style="color:${p.color}">\u25CF</span> ${p.seriesName}: <b>${val}</b>`;
                        });
                    return `${timeStr}<br/>${lines.join("<br/>")}`;
                },
            },
            legend: chart.display.showLegend ? {
                data: legendData,
                bottom: chart.display.showDataZoom ? 30 : 0,
                textStyle: { color: "#888" },
            } : undefined,
            xAxis: { type: "time", axisLabel: { color: "#888" }, splitLine: { show: false } },
            yAxis: yAxes,
            series: allSeries,
            dataZoom: chart.display.showDataZoom ? [
                { type: "inside", xAxisIndex: 0 },
                { type: "slider", xAxisIndex: 0, height: 25, bottom: 0 },
            ] : [],
            toolbox: { right: 10, top: 5, feature: { saveAsImage: { pixelRatio: 2, title: "PNG" }, restore: { title: "Reset" } } },
        };
    }, [chart, measurements, metricPoints, computedSeries, compareRange, compareMeasurements, timeRange]);

    if (!option) {
        return (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                Add sensors to see data
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
