/**
 * Measurement Chart Component
 * Time-series line chart for displaying sensor measurements
 * Supports toggling individual metrics on/off via clickable chips
 */

"use client";

import { useMemo, useState, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { formatDate } from "@/lib/utils/format";
import type { Measurement } from "@/lib/api/types";

interface MeasurementChartProps {
    measurements: Measurement[];
    height?: number;
}

// Color palette for different metrics
const COLORS = ["#6366f1", "#ec4899", "#22c55e", "#f59e0b", "#8b5cf6", "#14b8a6", "#f43f5e", "#a855f7"];

export function MeasurementChart({ measurements, height = 300 }: MeasurementChartProps) {
    // Group measurements by metric name
    const chartData = useMemo(() => {
        const dataByTime = measurements.reduce((acc, m) => {
            const timeKey = m.time;
            if (!acc[timeKey]) {
                acc[timeKey] = { time: timeKey };
            }
            acc[timeKey][m.metricName] = m.value;
            return acc;
        }, {} as Record<number, any>);

        return Object.values(dataByTime).sort((a, b) => a.time - b.time);
    }, [measurements]);

    // Get unique metric names for lines
    const metricNames = useMemo(() => {
        return Array.from(new Set(measurements.map(m => m.metricName)));
    }, [measurements]);

    // Track which metrics are visible — default all on
    const [visibleMetrics, setVisibleMetrics] = useState<Set<string>>(new Set(metricNames));

    // Only reset when the available metric names actually change (not on every data refresh)
    const metricKey = metricNames.slice().sort().join(",");
    useEffect(() => {
        setVisibleMetrics((prev) => {
            // If the user already has a valid selection, keep it and just add any new metrics
            const stillValid = new Set([...prev].filter((m) => metricNames.includes(m)));
            if (stillValid.size > 0) {
                // Add any newly appeared metrics
                for (const m of metricNames) {
                    if (!prev.has(m)) stillValid.add(m);
                }
                return stillValid;
            }
            // First load or all previous selections gone — show everything
            return new Set(metricNames);
        });
    }, [metricKey]);

    const allVisible = visibleMetrics.size === metricNames.length;

    function toggleMetric(name: string) {
        setVisibleMetrics((prev) => {
            const next = new Set(prev);
            if (next.has(name)) {
                // Don't allow hiding the last metric
                if (next.size <= 1) return prev;
                next.delete(name);
            } else {
                next.add(name);
            }
            return next;
        });
    }

    function toggleAll() {
        if (allVisible) {
            // Show only the first metric
            setVisibleMetrics(new Set([metricNames[0]]));
        } else {
            setVisibleMetrics(new Set(metricNames));
        }
    }

    if (chartData.length === 0) {
        return (
            <div className="flex items-center justify-center h-64 text-muted-foreground">
                No measurement data available
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {/* Metric toggle chips */}
            {metricNames.length > 1 && (
                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={toggleAll}
                        className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                            allVisible
                                ? "bg-foreground text-background border-foreground"
                                : "bg-card text-muted-foreground border-border hover:border-foreground/30"
                        }`}
                    >
                        All
                    </button>
                    {metricNames.map((name, index) => {
                        const color = COLORS[index % COLORS.length];
                        const active = visibleMetrics.has(name);
                        return (
                            <button
                                key={name}
                                type="button"
                                onClick={() => toggleMetric(name)}
                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                                    active
                                        ? "border-transparent text-white"
                                        : "bg-card text-muted-foreground border-border hover:border-foreground/30"
                                }`}
                                style={active ? { backgroundColor: color } : undefined}
                            >
                                <span
                                    className="w-2 h-2 rounded-full shrink-0"
                                    style={{ backgroundColor: color, opacity: active ? 1 : 0.4 }}
                                />
                                {name}
                            </button>
                        );
                    })}
                </div>
            )}

            {/* Chart */}
            <ResponsiveContainer width="100%" height={height}>
                <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" />
                    <XAxis
                        dataKey="time"
                        tickFormatter={(time) => formatDate(time, "HH:mm")}
                        stroke="rgb(var(--muted-foreground))"
                        style={{ fontSize: "12px" }}
                    />
                    <YAxis
                        stroke="rgb(var(--muted-foreground))"
                        style={{ fontSize: "12px" }}
                    />
                    <Tooltip
                        contentStyle={{
                            backgroundColor: "rgb(var(--card))",
                            border: "1px solid rgb(var(--border))",
                            borderRadius: "8px",
                            color: "rgb(var(--foreground))",
                        }}
                        labelFormatter={(time) => formatDate(time as number, "PPp")}
                        formatter={(value: number, name: string) => [value.toFixed(2), name]}
                    />
                    {metricNames.map((metricName, index) => (
                        <Line
                            key={metricName}
                            type="monotone"
                            dataKey={metricName}
                            stroke={COLORS[index % COLORS.length]}
                            strokeWidth={2}
                            dot={false}
                            activeDot={{ r: 4 }}
                            connectNulls={true}
                            name={metricName}
                            hide={!visibleMetrics.has(metricName)}
                        />
                    ))}
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
}
