"use client";

import { useLatestMeasurements } from "@/lib/hooks/useAsset";
import { useKpiValue } from "@/lib/hooks/useKpiValue";
import { Card, CardContent } from "@/components/ui/Card";
import type { DashboardWidget, TimeRange } from "@/lib/api/types";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";

interface Props {
    widget: DashboardWidget;
    timeRange?: TimeRange;
    live: boolean;
}

export function StatusWidget({ widget, timeRange, live }: Props) {
    const { config } = widget;
    const isKpi = !!config.kpiFormulaId;

    const { value: kpiValue, isLoading: kpiLoading, isError: kpiError } = useKpiValue(
        isKpi ? config.kpiFormulaId! : null
    );

    const metricFilter = config.metric ? [config.metric] : undefined;
    const { measurements, isLoading: metricsLoading, isError: metricsError } = useLatestMeasurements(
        !isKpi ? (config.assetId || null) : null, metricFilter
    );

    const isLoading = isKpi ? kpiLoading : metricsLoading;
    const isError = isKpi ? kpiError : metricsError;

    // config.metric may be a UUID (metric-point ID) while metricName is the display name,
    // so match by name first, then fall back to the first result (already filtered by the API).
    const metricData = measurements.find(m => m.metricName === config.metric)
        ?? measurements[0]
        ?? undefined;
    const valueStr = isKpi
        ? (kpiValue != null ? String(kpiValue) : undefined)
        : (metricData ? String(metricData.value) : undefined);
    
    const stateConfig = config.states && valueStr ? config.states[valueStr] : undefined;
    
    const displayLabel = stateConfig?.label || valueStr || "Unknown";
    const displayColor = stateConfig?.color || "gray";

    return (
        <Card className="h-full">
            <CardContent className="h-full flex flex-col items-center justify-center p-6 text-center">
                <p className="text-sm font-medium text-muted-foreground mb-3 uppercase tracking-wider">
                    {widget.title || config.metric || "Status"}
                </p>
                
                {isLoading ? (
                    <LoadingSpinner />
                ) : isError ? (
                    <span className="text-danger font-medium">Error</span>
                ) : valueStr === undefined ? (
                    <span className="text-muted-foreground">No Data</span>
                ) : (
                    <div className="flex items-center gap-3">
                        <div 
                            className="h-4 w-4 rounded-full shadow-inner" 
                            style={{ backgroundColor: displayColor }}
                        />
                        <span className="text-2xl font-bold text-foreground">
                            {displayLabel}
                        </span>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
