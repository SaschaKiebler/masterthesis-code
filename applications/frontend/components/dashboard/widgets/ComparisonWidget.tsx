"use client";

/**
 * ComparisonWidget (ADR-013)
 * Shows the same physical quantity across multiple buildings as overlaid lines.
 */

import { useState, useEffect, useMemo } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent, LegendComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { DashboardWidget, TimeRange } from "@/lib/api/types";
import { getMetricPoints, type MetricPoint } from "@/lib/api/metric-points";
import { getMeasurements } from "@/lib/api/assets";
import { AlertCircle, RefreshCw } from "lucide-react";

echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

interface Props {
    widget: DashboardWidget;
    timeRange?: TimeRange;
    live: boolean;
}

interface SeriesData {
    objectId: string;
    label: string;
    data: Array<[number, number]>;
}

export function ComparisonWidget({ widget, timeRange }: Props) {
    const { config } = widget;
    const [seriesData, setSeriesData] = useState<SeriesData[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const objectIds = config.objectIds ?? [];
    const quantityName = config.quantityName;

    useEffect(() => {
        if (!quantityName || objectIds.length === 0) {
            setLoading(false);
            return;
        }

        let cancelled = false;
        setLoading(true);
        setError(null);

        async function load() {
            try {
                // For each object, find the metric point measuring this quantity, then fetch measurements
                const results = await Promise.all(
                    objectIds.map(async (objectId) => {
                        const metricPoints = await getMetricPoints(objectId);
                        const mp = metricPoints.find(
                            (p) => p.quantityName === quantityName
                        );
                        if (!mp) return null;

                        const measurements = await getMeasurements(
                            mp.deviceId,
                            timeRange,
                            60
                        );
                        const filtered = measurements.measurements.filter(
                            (m) => m.metricId === mp.metricId
                        );
                        return {
                            objectId,
                            label: objectId, // Ideally resolved to display name
                            data: filtered.map(
                                (m): [number, number] => [m.time * 1000, m.value]
                            ),
                        };
                    })
                );

                if (!cancelled) {
                    setSeriesData(results.filter((r): r is SeriesData => r !== null));
                }
            } catch (e: unknown) {
                if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        load();
        return () => { cancelled = true; };
    }, [quantityName, objectIds.join(","), timeRange?.from, timeRange?.to]);

    const COLORS = ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#3b82f6", "#ec4899"];

    const option = useMemo(() => ({
        tooltip: { trigger: "axis" },
        legend: { data: seriesData.map((s) => s.label), bottom: 0 },
        grid: { top: 8, right: 8, bottom: 40, left: 40 },
        xAxis: { type: "time" },
        yAxis: { type: "value", name: quantityName ?? "" },
        series: seriesData.map((s, i) => ({
            name: s.label,
            type: "line",
            data: s.data,
            smooth: true,
            showSymbol: false,
            lineStyle: { color: COLORS[i % COLORS.length], width: 1.5 },
            itemStyle: { color: COLORS[i % COLORS.length] },
        })),
    }), [seriesData, quantityName]);

    if (!quantityName || objectIds.length === 0) {
        return (
            <div className="rounded-lg border border-dashed border-border p-4 h-full flex items-center justify-center">
                <p className="text-sm text-muted-foreground">Configure quantity and objects</p>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="rounded-lg border border-border bg-card p-4 h-full flex items-center justify-center">
                <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="rounded-lg border border-destructive/30 bg-card p-4 h-full flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-destructive shrink-0" />
                <p className="text-sm text-destructive">{error}</p>
            </div>
        );
    }

    return (
        <div className="rounded-lg border border-border bg-card p-4 h-full flex flex-col gap-2">
            <h3 className="text-sm font-medium text-foreground">
                {widget.title || quantityName}
            </h3>
            <div className="flex-1 min-h-0">
                <ReactEChartsCore
                    echarts={echarts}
                    option={option}
                    style={{ height: "100%", width: "100%" }}
                    opts={{ renderer: "canvas" }}
                />
            </div>
        </div>
    );
}
