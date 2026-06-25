"use client";

/**
 * EventLogWidget — scrollable log of boolean state changes over time.
 * Fetches time-series measurements for a single metric and displays
 * each state change as a row with timestamp, state label, and color.
 * States are user-configurable (value → { label, color }).
 */

import { useMemo } from "react";
import { useMeasurements } from "@/lib/hooks/useAsset";
import { TIME_PRESET_SECONDS } from "@/lib/utils/timeBuckets";
import type { DashboardWidget, TimeRange, Measurement } from "@/lib/api/types";
import { RefreshCw, AlertCircle, List } from "lucide-react";

interface Props {
    widget: DashboardWidget;
    timeRange?: TimeRange;
    live: boolean;
}

interface StateChange {
    time: number;
    value: string;
    label: string;
    color: string;
    durationSeconds: number | null; // null for the most recent (ongoing)
}

const ROW_HEIGHT_PX = 150; // approximate px per grid row span unit

export function EventLogWidget({ widget, timeRange }: Props) {
    const { config } = widget;
    const rowSpan = widget.position?.rowSpan ?? 2;
    const maxHeight = rowSpan * ROW_HEIGHT_PX;

    const metricFilter = config.metricPointId
        ? [config.metricPointId]
        : config.metric
            ? [config.metric]
            : undefined;

    // Resolve per-widget time range (preset overrides page-level)
    const effectiveTimeRange = useMemo(() => {
        if (config.timePreset && TIME_PRESET_SECONDS[config.timePreset]) {
            const spanSec = TIME_PRESET_SECONDS[config.timePreset];
            const nowSec = Math.floor(Date.now() / 1000);
            return { from: nowSec - spanSec, to: nowSec };
        }
        return timeRange;
    }, [config.timePreset, timeRange]);

    // Fetch raw measurements (bucketMinutes=0 = no bucketing) for 1-second precision
    const { measurements, isLoading, isError } = useMeasurements(
        config.assetId || null,
        effectiveTimeRange,
        0,
        metricFilter
    );

    const states = config.states ?? {};

    // Detect state changes: filter consecutive measurements where value differs
    const stateChanges = useMemo(() => {
        if (!measurements || measurements.length === 0) return [];

        // Sort by time ascending
        const sorted = [...measurements].sort((a, b) => a.time - b.time);

        const changes: StateChange[] = [];
        let prevValue: string | null = null;

        for (const m of sorted) {
            const valueStr = String(m.value);
            if (valueStr === prevValue) continue;

            const stateConfig = states[valueStr];
            changes.push({
                time: m.time,
                value: valueStr,
                label: stateConfig?.label || valueStr,
                color: stateConfig?.color || "#6b7280",
                durationSeconds: null,
            });
            prevValue = valueStr;
        }

        // Calculate durations between consecutive changes
        for (let i = 0; i < changes.length - 1; i++) {
            changes[i].durationSeconds = changes[i + 1].time - changes[i].time;
        }

        // Reverse to show most recent first
        return changes.reverse();
    }, [measurements, states]);

    if (isLoading) {
        return (
            <div className="rounded-lg border border-border bg-card p-4 flex items-center justify-center" style={{ height: maxHeight }}>
                <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (isError) {
        return (
            <div className="rounded-lg border border-destructive/30 bg-card p-4 flex items-center gap-2" style={{ height: maxHeight }}>
                <AlertCircle className="w-4 h-4 text-destructive shrink-0" />
                <p className="text-sm text-destructive">Failed to load measurements</p>
            </div>
        );
    }

    const hasConfig = config.assetId && metricFilter;

    return (
        <div
            className="rounded-lg border border-border bg-card flex flex-col overflow-hidden"
            style={{ height: maxHeight }}
        >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                    <List className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <h3 className="text-sm font-medium text-foreground truncate">
                        {widget.title || "Event Log"}
                    </h3>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">
                    {stateChanges.length} change{stateChanges.length !== 1 ? "s" : ""}
                </span>
            </div>

            {/* Body */}
            {!hasConfig ? (
                <div className="flex-1 flex items-center justify-center p-4">
                    <p className="text-xs text-muted-foreground text-center">
                        Select an asset and metric to display state changes.
                    </p>
                </div>
            ) : stateChanges.length === 0 ? (
                <div className="flex-1 flex items-center justify-center p-4">
                    <p className="text-xs text-muted-foreground text-center">
                        No state changes in this period
                    </p>
                </div>
            ) : (
                <div className="flex-1 overflow-y-auto">
                    <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-card z-10">
                            <tr className="border-b border-border/50 text-muted-foreground">
                                <th className="text-left font-medium px-4 py-2">State</th>
                                <th className="text-left font-medium px-2 py-2">Time</th>
                                <th className="text-right font-medium px-4 py-2">Duration</th>
                            </tr>
                        </thead>
                        <tbody>
                            {stateChanges.map((change, i) => (
                                <tr
                                    key={`${change.time}-${i}`}
                                    className="border-b border-border/30 hover:bg-muted/30 transition-colors"
                                >
                                    <td className="px-4 py-2">
                                        <div className="flex items-center gap-2">
                                            <div
                                                className="h-2.5 w-2.5 rounded-full shrink-0"
                                                style={{ backgroundColor: change.color }}
                                            />
                                            <span className="font-medium text-foreground">
                                                {change.label}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-2 py-2 text-muted-foreground whitespace-nowrap">
                                        {formatTimestamp(change.time)}
                                    </td>
                                    <td className="px-4 py-2 text-right text-muted-foreground whitespace-nowrap">
                                        {change.durationSeconds != null
                                            ? formatDuration(change.durationSeconds)
                                            : "ongoing"}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

function formatTimestamp(epochSeconds: number): string {
    const d = new Date(epochSeconds * 1000);
    return d.toLocaleString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    });
}

function formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return s > 0 ? `${m}m ${s}s` : `${m}m`;
    }
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h < 24) return m > 0 ? `${h}h ${m}m` : `${h}h`;
    const d = Math.floor(h / 24);
    const remainH = h % 24;
    return remainH > 0 ? `${d}d ${remainH}h` : `${d}d`;
}
