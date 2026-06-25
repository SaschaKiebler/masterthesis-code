"use client";

import { useMemo } from "react";
import useSWR from "swr";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import {
    GridComponent,
    TooltipComponent,
    DataZoomComponent,
    LegendComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { getMeasurements } from "@/lib/api/assets";
import { getKpiHistory, type KpiHistoryResponse } from "@/lib/api/kpiFormulas";
import { TIME_PRESET_SECONDS, bucketForPreset, autoBucketMinutes } from "@/lib/utils/timeBuckets";
import type { DashboardWidget, TimeRange, Measurement } from "@/lib/api/types";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { AlertCircle } from "lucide-react";

echarts.use([
    LineChart,
    GridComponent,
    TooltipComponent,
    DataZoomComponent,
    LegendComponent,
    CanvasRenderer,
]);

// ─── Hook: fetch measurements for multiple asset IDs in parallel ─────────────

interface AssetMeasurements {
    assetId: string;
    measurements: Measurement[];
}

function useSeriesMeasurements(
    assetMetrics: Record<string, string[]>,
    timeRange?: TimeRange,
    bucketMinutes = 60
) {
    const assetIds = Object.keys(assetMetrics);
    // Build a stable cache key that includes per-asset metric names
    const metricsKey = assetIds.map((id) => `${id}:${assetMetrics[id].join("+")}`).join(",");
    const key =
        assetIds.length > 0
            ? `dashboard-ts:${metricsKey}:${timeRange?.from || ""}:${timeRange?.to || ""}:${bucketMinutes}`
            : null;

    const { data, error, isLoading } = useSWR<AssetMeasurements[]>(
        key,
        async () => {
            const results = await Promise.all(
                assetIds.map(async (id) => {
                    const metrics = assetMetrics[id];
                    const res = await getMeasurements(id, timeRange, bucketMinutes, metrics);
                    return { assetId: id, measurements: res.measurements };
                })
            );
            return results;
        },
        {
            refreshInterval: 30000,
            keepPreviousData: true,
            revalidateOnFocus: false,
        }
    );

    return {
        data: data || [],
        isLoading: isLoading && !data,
        isError: error,
    };
}

// ─── Component ───────────────────────────────────────────────────────────────

interface Props {
    widget: DashboardWidget;
    timeRange?: TimeRange;
    live: boolean;
}

function formatTime(epochMs: number): string {
    return new Date(epochMs).toLocaleString("de-DE", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function formatTooltipTime(epochMs: number): string {
    return new Date(epochMs).toLocaleString("de-DE", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

export function TimeSeriesWidget({ widget, timeRange }: Props) {
    const { config } = widget;
    const series = config.series ?? [];

    // ─── Resolve per-widget time range + bucket ──────────────────────────
    const { effectiveTimeRange, effectiveBucket } = useMemo(() => {
        if (config.timePreset && TIME_PRESET_SECONDS[config.timePreset]) {
            const spanSec = TIME_PRESET_SECONDS[config.timePreset];
            const nowSec = Math.floor(Date.now() / 1000);
            const localRange = { from: nowSec - spanSec, to: nowSec };
            // bucketMinutes 0 = raw (all data points), undefined = auto
            const bucket = config.bucketMinutes != null ? config.bucketMinutes : bucketForPreset(config.timePreset);
            return { effectiveTimeRange: localRange, effectiveBucket: bucket };
        }
        // Fall back to page-level timeRange; auto-calculate bucket from span
        let bucket = config.bucketMinutes != null ? config.bucketMinutes : 60;
        if (config.bucketMinutes == null && timeRange) {
            bucket = autoBucketMinutes(timeRange.to - timeRange.from);
        }
        return { effectiveTimeRange: timeRange, effectiveBucket: bucket };
    }, [config.timePreset, config.bucketMinutes, timeRange]);

    // Separate KPI series from normal metric series
    const kpiSeries = useMemo(() => series.filter((s) => !!s.kpiFormulaId), [series]);
    const metricSeries = useMemo(() => series.filter((s) => !s.kpiFormulaId), [series]);

    // Group metric names by assetId for backend filtering.
    // Metrics identified by a numeric metricId (ADR-013 metric points) are filtered
    // client-side, so we skip their UUID string to avoid confusing the backend.
    // Only legacy signal_map string metrics (no metricId) are passed as server-side filters.
    const assetMetrics = useMemo(() => {
        const map: Record<string, string[]> = {};
        for (const s of metricSeries) {
            if (!s.assetId) continue;
            if (!map[s.assetId]) map[s.assetId] = [];
            if (s.metric && s.metricId == null && !map[s.assetId].includes(s.metric)) {
                map[s.assetId].push(s.metric);
            }
        }
        return map;
    }, [metricSeries]);

    const { data: assetData, isLoading, isError } = useSeriesMeasurements(
        assetMetrics,
        effectiveTimeRange,
        effectiveBucket
    );

    // Fetch KPI history as real time series data
    const kpiKey = kpiSeries.length > 0 && effectiveTimeRange
        ? `ts-kpi-history:${kpiSeries.map((s) => s.kpiFormulaId).join(",")}:${effectiveTimeRange.from}:${effectiveTimeRange.to}`
        : null;
    const { data: kpiHistories } = useSWR<Record<string, KpiHistoryResponse>>(
        kpiKey,
        async () => {
            const results = await Promise.allSettled(
                kpiSeries.map((s) => getKpiHistory(s.kpiFormulaId!, effectiveTimeRange!.from, effectiveTimeRange!.to))
            );
            const map: Record<string, KpiHistoryResponse> = {};
            results.forEach((r, i) => {
                if (r.status === "fulfilled") map[kpiSeries[i].kpiFormulaId!] = r.value;
            });
            return map;
        },
        { refreshInterval: 30_000, revalidateOnFocus: false }
    );

    // Index measurements by assetId for fast lookup
    const measurementsByAsset = useMemo(() => {
        const map = new Map<string, Measurement[]>();
        for (const entry of assetData) {
            map.set(entry.assetId, entry.measurements);
        }
        return map;
    }, [assetData]);

    const totalPoints = useMemo(() => {
        const measurementPoints = assetData.reduce((sum, e) => sum + e.measurements.length, 0);
        const kpiPoints = kpiHistories
            ? Object.values(kpiHistories).reduce((sum, h) => sum + h.points.length, 0)
            : 0;
        return measurementPoints + kpiPoints;
    }, [assetData, kpiHistories]);

    // Build ECharts option directly from measurement data
    const option = useMemo(() => {
        const echartsSeries: any[] = [];

        for (const s of metricSeries) {
            if (!s.assetId || !s.metric) continue;
            const measurements = measurementsByAsset.get(s.assetId) || [];

            // Filter for the requested metric and build [time, value] pairs.
            // Match by numeric metricId if available (metric point), otherwise by metricName (legacy).
            const data = measurements
                .filter((m) =>
                    s.metricId != null
                        ? m.metricId === s.metricId
                        : m.metricName === s.metric
                )
                .map((m) => [m.time * 1000, m.value] as [number, number])
                .sort((a, b) => a[0] - b[0]);

            const color = s.color || "#6366f1";
            echartsSeries.push({
                name: s.label || s.metric.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
                type: "line",
                data,
                showSymbol: false,
                smooth: false,
                lineStyle: { width: 2, color },
                itemStyle: { color },
                emphasis: { lineStyle: { width: 3 } },
            });
        }

        // Add KPI series as regular line series from historical derived_properties
        for (const s of kpiSeries) {
            if (!s.kpiFormulaId || !kpiHistories?.[s.kpiFormulaId]) continue;
            const history = kpiHistories[s.kpiFormulaId];
            const color = s.color || "#f59e0b";
            const label = s.label || history.formula.displayName;
            const data = history.points
                .filter((p) => p.value != null)
                .map((p) => [p.time * 1000, p.value] as [number, number])
                .sort((a, b) => a[0] - b[0]);

            echartsSeries.push({
                name: label,
                type: "line",
                data,
                showSymbol: false,
                smooth: false,
                lineStyle: { width: 2, color },
                itemStyle: { color },
                emphasis: { lineStyle: { width: 3 } },
            });
        }

        return {
            animation: true,
            animationDuration: 300,
            grid: { left: 50, right: 20, top: 30, bottom: 60, containLabel: false },
            legend: {
                show: echartsSeries.length > 1,
                bottom: 35,
                textStyle: { fontSize: 10, color: "rgba(var(--muted-foreground), 1)" },
                itemWidth: 12,
                itemHeight: 8,
            },
            tooltip: {
                trigger: "axis" as const,
                axisPointer: { type: "cross" as const, crossStyle: { color: "#999" } },
                backgroundColor: "rgba(var(--card), 0.95)",
                borderColor: "rgba(var(--border), 1)",
                textStyle: { color: "rgba(var(--foreground), 1)", fontSize: 12 },
                formatter: (params: any) => {
                    if (!Array.isArray(params) || params.length === 0) return "";
                    const time = formatTooltipTime(params[0].data[0]);
                    let html = `<div style="font-weight:600;margin-bottom:4px">${time}</div>`;
                    for (const p of params) {
                        if (p.data[1] == null) continue;
                        html += `<div style="display:flex;align-items:center;gap:6px;margin:2px 0">
                            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color}"></span>
                            <span style="flex:1">${p.seriesName}</span>
                            <span style="font-weight:600">${p.data[1].toFixed(2)}${config.yAxis?.unit ? ` ${config.yAxis.unit}` : ""}</span>
                        </div>`;
                    }
                    return html;
                },
            },
            xAxis: {
                type: "time" as const,
                axisLabel: { fontSize: 11, formatter: (v: number) => formatTime(v) },
                splitLine: { show: false },
            },
            yAxis: {
                type: "value" as const,
                name: config.yAxis?.unit || "",
                nameTextStyle: { fontSize: 11, padding: [0, 0, 0, -30] },
                axisLabel: { fontSize: 11 },
                splitLine: { lineStyle: { type: "dashed" as const, opacity: 0.3 } },
                min: config.yAxis?.min ?? undefined,
                max: config.yAxis?.max ?? undefined,
            },
            dataZoom: [
                { type: "inside", xAxisIndex: 0, filterMode: "none" },
                {
                    type: "slider",
                    xAxisIndex: 0,
                    height: 20,
                    bottom: 5,
                    filterMode: "none",
                    borderColor: "rgba(var(--border), 1)",
                    backgroundColor: "rgba(var(--muted), 0.5)",
                    fillerColor: "rgba(99, 102, 241, 0.15)",
                    handleStyle: { color: "#6366f1" },
                },
            ],
            series: echartsSeries,
        };
    }, [metricSeries, kpiSeries, measurementsByAsset, kpiHistories, config.yAxis]);

    const noSeriesConfigured = series.length === 0 || series.every((s) => !s.kpiFormulaId && (!s.assetId || !s.metric));

    return (
        <Card className="h-full flex flex-col">
            <CardHeader className="pb-2 flex-none">
                <CardTitle className="text-sm font-medium">{widget.title}</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 min-h-[250px] relative">
                {noSeriesConfigured ? (
                    <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
                        No series configured. Add data sources in Build Mode.
                    </div>
                ) : isLoading && totalPoints === 0 ? (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <LoadingSpinner />
                    </div>
                ) : isError ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
                        <AlertCircle className="h-8 w-8 text-danger mb-2" />
                        <p className="text-sm">Failed to load data</p>
                    </div>
                ) : totalPoints === 0 ? (
                    <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
                        No data in selected range
                    </div>
                ) : (
                    <div className="absolute inset-0">
                        <ReactEChartsCore
                            echarts={echarts}
                            option={option}
                            style={{ height: "100%", width: "100%" }}
                            notMerge={false}
                            lazyUpdate={true}
                        />
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
