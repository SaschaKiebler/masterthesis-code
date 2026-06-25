"use client";

import { useLatestMeasurements } from "@/lib/hooks/useAsset";
import { useKpiValue } from "@/lib/hooks/useKpiValue";
import { StatsCard } from "@/components/charts/StatsCard";
import type { DashboardWidget, TimeRange } from "@/lib/api/types";
import { applyValueTransform, getTransformedUnit } from "@/lib/utils/valueTransform";
import { Activity } from "lucide-react";

interface Props {
    widget: DashboardWidget;
    timeRange?: TimeRange;
    live: boolean;
}

export function StatCardWidget({ widget, timeRange, live }: Props) {
    const { config } = widget;
    const isKpi = !!config.kpiFormulaId;

    // KPI evaluation (only runs when kpiFormulaId is set)
    const { value: kpiValue, unit: kpiUnit, isLoading: kpiLoading, isError: kpiError } = useKpiValue(
        isKpi ? config.kpiFormulaId! : null
    );

    // Prefer metricPointId (ADR-013 metric points), fall back to metric (legacy signal_map name)
    const metricKey = config.metricPointId || config.metric;
    const metricFilter = metricKey ? [metricKey] : undefined;
    const { measurements, isLoading: metricsLoading, isError: metricsError } = useLatestMeasurements(
        !isKpi ? (config.assetId || null) : null, metricFilter
    );

    // When filtered to a single metric, take the first result directly;
    // otherwise match by name for backward compatibility
    const metricData = measurements.length === 1
        ? measurements[0]
        : measurements.find(m => m.metricName === config.metric);

    const unit = isKpi ? kpiUnit : getTransformedUnit(config);
    const isLoading = isKpi ? kpiLoading : metricsLoading;
    const isError = isKpi ? kpiError : metricsError;

    let displayValue: string | number = "—";
    if (isLoading) displayValue = "…";
    else if (isError) displayValue = "Error";
    else if (isKpi && kpiValue !== null) {
        displayValue = applyValueTransform(kpiValue, config.valueTransform);
        if (unit) displayValue = `${displayValue} ${unit}`;
    } else if (!isKpi && metricData) {
        displayValue = typeof metricData.value === "number"
            ? applyValueTransform(metricData.value, config.valueTransform)
            : metricData.value;

        if (unit) {
            displayValue = `${displayValue} ${unit}`;
        }
    }

    return (
        <StatsCard
            title={widget.title || config.metric || "Value"}
            value={displayValue}
            icon={Activity}
            className="h-full"
        />
    );
}
