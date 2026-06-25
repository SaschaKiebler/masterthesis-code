"use client";

import { useState } from "react";
import { Calendar, GitCompareArrows, X } from "lucide-react";
import type { TimeRange } from "@/lib/api/types";

const TIME_PRESETS = ["24h", "3d", "7d", "30d", "Season"];

function epochToDatetimeLocal(epoch: number): string {
    const d = new Date(epoch * 1000);
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function datetimeLocalToEpoch(str: string): number {
    return Math.floor(new Date(str).getTime() / 1000);
}

function formatShort(epoch: number): string {
    return new Date(epoch * 1000).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

const BUCKET_OPTIONS = [
    { value: null, label: "Auto" },
    { value: 0, label: "Raw" },
    { value: 1, label: "1 min" },
    { value: 5, label: "5 min" },
    { value: 15, label: "15 min" },
    { value: 60, label: "1 h" },
    { value: 360, label: "6 h" },
    { value: 1440, label: "1 d" },
];

interface TimeRangeBarProps {
    activePreset: string;
    onChange: (preset: string) => void;
    isLoading: boolean;
    customRange: TimeRange | null;
    onCustomRangeChange: (range: TimeRange) => void;
    compareRange: TimeRange | null;
    onCompareRangeChange: (range: TimeRange | null) => void;
    timeRange: TimeRange;
    bucketMinutes: number | null;
    onBucketChange: (bucket: number | null) => void;
}

export function TimeRangeBar({
    activePreset,
    onChange,
    isLoading,
    customRange,
    onCustomRangeChange,
    compareRange,
    onCompareRangeChange,
    timeRange,
    bucketMinutes,
    onBucketChange,
}: TimeRangeBarProps) {
    const isCustom = activePreset === "custom";
    const [showCompare, setShowCompare] = useState(!!compareRange);

    const handlePreset = (preset: string) => {
        onChange(preset);
    };

    const handleCustomToggle = () => {
        if (!isCustom) {
            // Initialize custom range from current active timeRange
            onCustomRangeChange({ from: timeRange.from, to: timeRange.to });
        } else {
            onChange("7d");
        }
    };

    const handleCompareToggle = () => {
        if (showCompare) {
            setShowCompare(false);
            onCompareRangeChange(null);
        } else {
            setShowCompare(true);
            // Default: same duration, shifted back
            const duration = timeRange.to - timeRange.from;
            onCompareRangeChange({ from: timeRange.from - duration, to: timeRange.from });
        }
    };

    return (
        <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-muted-foreground">Time range:</span>
                {TIME_PRESETS.map((preset) => (
                    <button
                        key={preset}
                        onClick={() => handlePreset(preset)}
                        className={`px-3 py-1 text-sm rounded-md transition-colors ${
                            activePreset === preset
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-foreground hover:bg-muted/80"
                        }`}
                    >
                        {preset}
                    </button>
                ))}

                <button
                    onClick={handleCustomToggle}
                    className={`px-3 py-1 text-sm rounded-md transition-colors flex items-center gap-1 ${
                        isCustom
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-foreground hover:bg-muted/80"
                    }`}
                >
                    <Calendar className="w-3.5 h-3.5" />
                    Custom
                </button>

                <button
                    onClick={handleCompareToggle}
                    className={`px-3 py-1 text-sm rounded-md transition-colors flex items-center gap-1 ${
                        showCompare
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-foreground hover:bg-muted/80"
                    }`}
                    title="Overlay data from another time range for comparison"
                >
                    <GitCompareArrows className="w-3.5 h-3.5" />
                    Compare
                </button>

                <div className="h-4 w-px bg-input mx-1" />

                <span className="text-sm text-muted-foreground">Resolution:</span>
                {BUCKET_OPTIONS.map((opt) => (
                    <button
                        key={String(opt.value)}
                        onClick={() => onBucketChange(opt.value)}
                        className={`px-2 py-1 text-xs rounded-md transition-colors ${
                            bucketMinutes === opt.value
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-foreground hover:bg-muted/80"
                        }`}
                    >
                        {opt.label}
                    </button>
                ))}

                {isLoading && (
                    <span className="text-xs text-muted-foreground animate-pulse ml-2">Loading...</span>
                )}
            </div>

            {/* Custom date picker */}
            {isCustom && (
                <div className="flex items-center gap-2 flex-wrap text-sm">
                    <span className="text-muted-foreground">From:</span>
                    <input
                        type="datetime-local"
                        value={customRange ? epochToDatetimeLocal(customRange.from) : ""}
                        onChange={(e) => {
                            if (!e.target.value) return;
                            const from = datetimeLocalToEpoch(e.target.value);
                            onCustomRangeChange({ from, to: customRange?.to ?? Math.floor(Date.now() / 1000) });
                        }}
                        className="bg-muted border border-input rounded px-2 py-1 text-foreground text-sm"
                    />
                    <span className="text-muted-foreground">To:</span>
                    <input
                        type="datetime-local"
                        value={customRange ? epochToDatetimeLocal(customRange.to) : ""}
                        onChange={(e) => {
                            if (!e.target.value) return;
                            const to = datetimeLocalToEpoch(e.target.value);
                            onCustomRangeChange({ from: customRange?.from ?? to - 86400, to });
                        }}
                        className="bg-muted border border-input rounded px-2 py-1 text-foreground text-sm"
                    />
                </div>
            )}

            {/* Compare range picker */}
            {showCompare && (
                <div className="flex items-center gap-2 flex-wrap text-sm">
                    <span className="text-muted-foreground flex items-center gap-1">
                        <GitCompareArrows className="w-3.5 h-3.5" />
                        Compare:
                    </span>
                    <input
                        type="datetime-local"
                        value={compareRange ? epochToDatetimeLocal(compareRange.from) : ""}
                        onChange={(e) => {
                            if (!e.target.value) return;
                            const from = datetimeLocalToEpoch(e.target.value);
                            // Keep same duration as primary range
                            const duration = timeRange.to - timeRange.from;
                            onCompareRangeChange({ from, to: from + duration });
                        }}
                        className="bg-muted border border-input rounded px-2 py-1 text-foreground text-sm"
                    />
                    <span className="text-muted-foreground">
                        to {compareRange ? formatShort(compareRange.to) : "—"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                        (same duration as primary: {Math.round((timeRange.to - timeRange.from) / 86400)}d)
                    </span>
                    <button
                        onClick={() => { setShowCompare(false); onCompareRangeChange(null); }}
                        className="text-muted-foreground hover:text-danger"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            )}
        </div>
    );
}
