"use client";

import { useLatestMeasurements } from "@/lib/hooks/useAsset";
import { useKpiValue } from "@/lib/hooks/useKpiValue";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import type { DashboardWidget, TimeRange } from "@/lib/api/types";
import { applyValueTransform, getTransformedUnit } from "@/lib/utils/valueTransform";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { useMemo } from "react";

interface Props {
    widget: DashboardWidget;
    timeRange?: TimeRange;
    live: boolean;
}

export function GaugeWidget({ widget, timeRange, live }: Props) {
    const { config } = widget;
    const isKpi = !!config.kpiFormulaId;

    // KPI evaluation (only runs when kpiFormulaId is set)
    const { value: kpiValue, unit: kpiUnit, isLoading: kpiLoading, isError: kpiError } = useKpiValue(
        isKpi ? config.kpiFormulaId! : null
    );

    // Don't pass a UUID metricPointId as a metric name filter — the backend filters by
    // metric name (e.g. "active_power"), not by UUID. Fetch all latest measurements and
    // filter client-side by numeric metricId when available (ADR-013 path), or by
    // metric name for legacy signal_map widgets.
    const metricFilter = config.metricPointId ? undefined : (config.metric ? [config.metric] : undefined);
    const { measurements, isLoading: metricsLoading, isError: metricsError } = useLatestMeasurements(
        !isKpi ? (config.assetId || null) : null, metricFilter
    );

    const metricData = measurements.find(m =>
        config.metricId != null ? m.metricId === config.metricId : m.metricName === config.metric
    );

    const isLoading = isKpi ? kpiLoading : metricsLoading;
    const isError = isKpi ? kpiError : metricsError;

    const rawValue = isKpi ? kpiValue ?? undefined : (metricData?.value as number | undefined);
    const value = rawValue !== undefined ? applyValueTransform(rawValue, config.valueTransform) : undefined;
    const unit = isKpi ? (kpiUnit || getTransformedUnit(config)) : getTransformedUnit(config);

    const min = config.yAxis?.min ?? 0;
    const max = config.yAxis?.max ?? 100;
    
    const percentage = useMemo(() => {
        if (value === undefined) return 0;
        const bounded = Math.max(min, Math.min(max, value));
        return ((bounded - min) / (max - min)) * 100;
    }, [value, min, max]);

    // Simple color gradient (green -> yellow -> red) if not specified
    const color = useMemo(() => {
        if (percentage < 33) return "hsl(var(--success))";
        if (percentage < 66) return "hsl(var(--warning))";
        return "hsl(var(--danger))";
    }, [percentage]);

    return (
        <Card className="h-full flex flex-col">
            <CardHeader className="pb-2 text-center border-b border-border/50">
                <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                    {widget.title || config.metric || "Gauge"}
                </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col items-center justify-center p-6 relative">
                {isLoading ? (
                    <LoadingSpinner />
                ) : isError ? (
                    <span className="text-danger font-medium">Error</span>
                ) : value === undefined ? (
                    <span className="text-muted-foreground">No Data</span>
                ) : (
                    <div className="relative flex items-center justify-center">
                        <svg className="w-32 h-32 transform -rotate-90">
                            {/* Background track */}
                            <circle
                                cx="64"
                                cy="64"
                                r="56"
                                stroke="currentColor"
                                strokeWidth="12"
                                fill="transparent"
                                className="text-muted/30"
                            />
                            {/* Value track */}
                            <circle
                                cx="64"
                                cy="64"
                                r="56"
                                stroke={color}
                                strokeWidth="12"
                                fill="transparent"
                                strokeDasharray={`${(percentage * 351.8) / 100} 351.8`}
                                className="transition-all duration-1000 ease-out"
                                strokeLinecap="round"
                            />
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <span className="text-2xl font-bold">
                                {value}
                            </span>
                            {unit && (
                                <span className="text-xs text-muted-foreground font-medium">
                                    {unit}
                                </span>
                            )}
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
