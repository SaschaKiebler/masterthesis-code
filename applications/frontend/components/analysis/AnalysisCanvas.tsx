"use client";

import { useCallback } from "react";
import { Plus } from "lucide-react";
import { TimeRangeBar } from "./TimeRangeBar";
import { ChartCard } from "./ChartCard";
import type { ProjectMetricPoint } from "@/lib/api/projects";
import type { Measurement, TimeRange } from "@/lib/api/types";
import type { CanvasDefinition, ChartDefinition } from "@/lib/api/analysis";
import { createEmptyChart } from "@/lib/api/analysis";

interface AnalysisCanvasProps {
    metricPoints: ProjectMetricPoint[];
    measurements: Measurement[];
    isLoading: boolean;
    canvas: CanvasDefinition;
    onCanvasChange: (canvas: CanvasDefinition) => void;
    timePreset: string;
    onTimePresetChange: (preset: string) => void;
    timeRange: TimeRange;
    customRange: TimeRange | null;
    onCustomRangeChange: (range: TimeRange) => void;
    compareRange: TimeRange | null;
    onCompareRangeChange: (range: TimeRange | null) => void;
    compareMeasurements: Measurement[];
    bucketMinutes: number | null;
    onBucketChange: (bucket: number | null) => void;
}

export function AnalysisCanvas({
    metricPoints,
    measurements,
    isLoading,
    canvas,
    onCanvasChange,
    timePreset,
    onTimePresetChange,
    timeRange,
    customRange,
    onCustomRangeChange,
    compareRange,
    onCompareRangeChange,
    compareMeasurements,
    bucketMinutes,
    onBucketChange,
}: AnalysisCanvasProps) {
    const handleAddChart = useCallback(() => {
        const id = crypto.randomUUID().slice(0, 8);
        onCanvasChange({
            ...canvas,
            charts: [...canvas.charts, createEmptyChart(id, canvas.charts.length)],
        });
    }, [canvas, onCanvasChange]);

    const handleUpdateChart = useCallback((index: number, updated: ChartDefinition) => {
        const charts = [...canvas.charts];
        charts[index] = updated;
        onCanvasChange({ ...canvas, charts });
    }, [canvas, onCanvasChange]);

    const handleRemoveChart = useCallback((index: number) => {
        onCanvasChange({ ...canvas, charts: canvas.charts.filter((_, i) => i !== index) });
    }, [canvas, onCanvasChange]);

    return (
        <div className="space-y-4">
            <TimeRangeBar
                activePreset={timePreset}
                onChange={onTimePresetChange}
                isLoading={isLoading}
                customRange={customRange}
                onCustomRangeChange={onCustomRangeChange}
                compareRange={compareRange}
                onCompareRangeChange={onCompareRangeChange}
                timeRange={timeRange}
                bucketMinutes={bucketMinutes}
                onBucketChange={onBucketChange}
            />

            {canvas.charts.map((chart, index) => (
                <ChartCard
                    key={chart.id}
                    chart={chart}
                    measurements={measurements}
                    metricPoints={metricPoints}
                    timeRange={timeRange}
                    compareRange={compareRange}
                    compareMeasurements={compareMeasurements}
                    bucketMinutes={bucketMinutes}
                    onUpdate={(updated) => handleUpdateChart(index, updated)}
                    onRemove={() => handleRemoveChart(index)}
                />
            ))}

            <button
                onClick={handleAddChart}
                className="w-full py-4 border-2 border-dashed border-input rounded-lg text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors flex items-center justify-center gap-2"
            >
                <Plus className="w-5 h-5" />
                <span className="text-sm font-medium">Add Chart</span>
            </button>
        </div>
    );
}
