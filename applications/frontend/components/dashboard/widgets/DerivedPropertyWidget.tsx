"use client";

/**
 * DerivedPropertyWidget (ADR-013)
 * Displays a current ML/pipeline derived property for an ontology object.
 */

import useSWR from "swr";
import type { DashboardWidget, TimeRange } from "@/lib/api/types";
import {
    getObjectDerivedProperties,
    type DerivedProperty,
    QUALITY_BADGE,
    SOURCE_BADGE,
} from "@/lib/api/derived-properties";
import { Brain, RefreshCw, AlertCircle } from "lucide-react";

interface Props {
    widget: DashboardWidget;
    timeRange?: TimeRange;
    live: boolean;
}

export function DerivedPropertyWidget({ widget }: Props) {
    const { config } = widget;

    const objectId = config.assetId; // reuse assetId field for the target object
    const propertyName = config.propertyName;

    const { data: allProps, error: fetchError, isLoading: loading } = useSWR<DerivedProperty[]>(
        objectId ? `derived-props:${objectId}` : null,
        () => getObjectDerivedProperties(objectId!),
        {
            revalidateOnFocus: false,
            revalidateOnReconnect: true,
            refreshInterval: 10_000,
        }
    );

    const property = allProps?.find((p) => p.propertyName === propertyName) ?? null;
    const error = fetchError ? (fetchError.message ?? "Failed to load") : null;

    if (!objectId || !propertyName) {
        return (
            <div className="rounded-lg border border-dashed border-border p-4 h-full flex items-center justify-center">
                <p className="text-sm text-muted-foreground">Configure object and property</p>
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

    if (!property) {
        return (
            <div className="rounded-lg border border-border bg-card p-4 h-full flex items-center justify-center">
                <p className="text-sm text-muted-foreground">No data available</p>
            </div>
        );
    }

    const displayValue = property.valueNumeric != null
        ? config.displayFormat === "percent"
            ? `${Math.round(property.valueNumeric * 100)}%`
            : Math.round(property.valueNumeric * 100) / 100
        : property.valueText ?? "—";

    const progress = property.valueNumeric != null && config.displayFormat === "percent"
        ? Math.min(100, Math.max(0, property.valueNumeric * 100))
        : null;

    // Threshold-based color override
    let thresholdColor: string | null = null;
    if (config.thresholds && property.valueNumeric != null) {
        const matched = [...(config.thresholds)]
            .sort((a, b) => b.value - a.value)
            .find((t) => (property.valueNumeric ?? 0) >= t.value);
        if (matched) thresholdColor = matched.color;
    }

    const qualityInfo = QUALITY_BADGE[property.quality];
    const sourceInfo = SOURCE_BADGE[property.sourceType];
    const computedAge = formatAge(property.computedAt);

    return (
        <div className="rounded-lg border border-border bg-card p-4 h-full flex flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                    <Brain className="w-4 h-4 text-violet-500 shrink-0" />
                    <h3 className="text-sm font-medium text-foreground truncate">
                        {widget.title || property.displayName}
                    </h3>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${sourceInfo.classes}`}>
                    {sourceInfo.label}
                </span>
            </div>

            <div className="flex items-end gap-2">
                <span
                    className="text-3xl font-bold tabular-nums"
                    style={thresholdColor ? { color: thresholdColor } : undefined}
                >
                    {displayValue}
                </span>
                {property.unit && (
                    <span className="text-sm text-muted-foreground mb-1">{property.unit}</span>
                )}
            </div>

            {progress != null && (
                <div className="w-full bg-muted rounded-full h-2">
                    <div
                        className="h-2 rounded-full transition-all"
                        style={{
                            width: `${progress}%`,
                            backgroundColor: thresholdColor ?? "#6366f1",
                        }}
                    />
                </div>
            )}

            <div className="flex items-center justify-between text-xs text-muted-foreground mt-auto">
                {property.sourceType !== "RULE" ? (
                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${qualityInfo.classes}`}>
                        {qualityInfo.label}
                    </span>
                ) : <span />}
                <div className="flex items-center gap-2">
                    {property.confidence != null && property.sourceType !== "RULE" && (
                        <span>{Math.round(property.confidence * 100)}% conf.</span>
                    )}
                    <span>{computedAge}</span>
                </div>
            </div>
        </div>
    );
}

function formatAge(isoTimestamp: string): string {
    const diff = Date.now() - new Date(isoTimestamp).getTime();
    const minutes = Math.floor(diff / 60_000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}
