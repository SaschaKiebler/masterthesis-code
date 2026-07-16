"use client";

import { randomUUID } from "@/lib/utils/uuid";
import { useState, useCallback, useMemo } from "react";
import { useRef } from "react";
import { Plus, Trash2, Calculator, X } from "lucide-react";
import { SourceTag } from "./SourceTag";
import { MetricPointPicker } from "./MetricPointPicker";
import { CalculationPicker } from "./CalculationPicker";
import { FormulaCalcEditor } from "./FormulaCalcEditor";
import { ColorSwatchPicker } from "./ColorSwatchPicker";
import { ExportButton } from "./ExportButton";
import { AiAnalyzeButton } from "./AiAnalyzeButton";
import { TimeSeriesChart } from "./TimeSeriesChart";
import { ScatterChart } from "./ScatterChart";
import { BoxplotChart } from "./BoxplotChart";
import { HeatmapChart } from "./HeatmapChart";
import { HistogramChart } from "./HistogramChart";
import { StatsTable } from "./StatsTable";
import type { ProjectMetricPoint } from "@/lib/api/projects";
import type { Measurement, TimeRange } from "@/lib/api/types";
import type { ChartDefinition, ChartSource, ChartType, ChartCalculation, CalculationType } from "@/lib/api/analysis";
import { getChartColor } from "@/lib/api/analysis";

const CHART_TYPES: { value: ChartType; label: string }[] = [
    { value: "time_series", label: "Time Series" },
    { value: "scatter", label: "Scatter" },
    { value: "boxplot", label: "Boxplot" },
    { value: "heatmap", label: "Heatmap" },
    { value: "histogram", label: "Histogram" },
    { value: "table", label: "Table" },
];

const CALC_LABELS: Record<string, string> = {
    mean: "Mean", median: "Median", moving_average: "Moving Avg",
    min_max_band: "Min/Max", std_band: "±σ Band", trend: "Trend",
    reference_line: "Ref Line", difference: "Difference", regression: "Regression",
    formula: "Formula",
};

interface ChartCardProps {
    chart: ChartDefinition;
    measurements: Measurement[];
    metricPoints: ProjectMetricPoint[];
    timeRange: TimeRange;
    compareRange: TimeRange | null;
    compareMeasurements: Measurement[];
    bucketMinutes: number | null;
    onUpdate: (chart: ChartDefinition) => void;
    onRemove: () => void;
}

export function ChartCard({ chart, measurements, metricPoints, timeRange, compareRange, compareMeasurements, bucketMinutes, onUpdate, onRemove }: ChartCardProps) {
    const [showPicker, setShowPicker] = useState(false);
    const [showCalcPicker, setShowCalcPicker] = useState(false);
    const [editingCalcId, setEditingCalcId] = useState<string | null>(null);
    const [editingTitle, setEditingTitle] = useState(false);
    const [resizing, setResizing] = useState(false);
    const [localHeight, setLocalHeight] = useState<number | null>(null);
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const resizeStartY = useRef(0);
    const resizeStartHeight = useRef(0);

    const chartHeight = localHeight ?? chart.position.height;

    const handleResizeStart = (e: React.MouseEvent) => {
        e.preventDefault();
        setResizing(true);
        resizeStartY.current = e.clientY;
        resizeStartHeight.current = chart.position.height;

        const handleMove = (ev: MouseEvent) => {
            const delta = ev.clientY - resizeStartY.current;
            const newHeight = Math.max(200, Math.min(800, resizeStartHeight.current + delta));
            setLocalHeight(newHeight);
        };
        const handleUp = () => {
            setResizing(false);
            setLocalHeight((h) => {
                if (h !== null) {
                    onUpdate({ ...chart, position: { ...chart.position, height: h } });
                }
                return null;
            });
            window.removeEventListener("mousemove", handleMove);
            window.removeEventListener("mouseup", handleUp);
        };
        window.addEventListener("mousemove", handleMove);
        window.addEventListener("mouseup", handleUp);
    };

    const handleAddSource = useCallback((mp: ProjectMetricPoint) => {
        const newSource: ChartSource = {
            id: `src-${randomUUID().slice(0, 8)}`,
            label: mp.quantityDisplayName || mp.displayName || `Metric ${mp.metricId}`,
            color: getChartColor(chart.sources.length),
            metricPointId: mp.id,
            yAxisIndex: mp.unit === "%" ? 1 : 0,
        };

        const display = { ...chart.display };
        if (newSource.yAxisIndex === 1 && display.yAxes.length < 2) {
            display.yAxes = [...display.yAxes, { unit: "%", position: "right" as const }];
        }

        onUpdate({ ...chart, sources: [...chart.sources, newSource], display });
        setShowPicker(false);
    }, [chart, onUpdate]);

    const handleRemoveSource = useCallback((sourceId: string) => {
        onUpdate({ ...chart, sources: chart.sources.filter((s) => s.id !== sourceId) });
    }, [chart, onUpdate]);

    const handleUpdateSource = useCallback((sourceId: string, updates: Partial<ChartSource>) => {
        onUpdate({
            ...chart,
            sources: chart.sources.map((s) => (s.id === sourceId ? { ...s, ...updates } : s)),
        });
    }, [chart, onUpdate]);

    const handleAddCalculation = useCallback((type: CalculationType, inputs: Record<string, string>) => {
        const defaultFormula = Object.keys(inputs).length >= 2 ? "a - b" : "a";
        // When a single-input calc targets another calculation's result, show that in the label
        const targetCalc = chart.calculations.find((c) => c.id === inputs.source);
        const baseLabel = CALC_LABELS[type] || type;
        const calc: ChartCalculation = {
            id: `calc-${randomUUID().slice(0, 8)}`,
            type,
            label: type === "formula" ? defaultFormula : targetCalc ? `${baseLabel} (${targetCalc.label})` : baseLabel,
            color: getChartColor(chart.sources.length + chart.calculations.length),
            inputs,
            params: type === "moving_average" ? { window: "24h" }
                : type === "formula" ? { formula: defaultFormula, showOnly: false }
                : {},
            showAs: type === "min_max_band" || type === "std_band" ? "band" : "line",
        };
        onUpdate({ ...chart, calculations: [...chart.calculations, calc] });
        setShowCalcPicker(false);
        if (type === "formula") setEditingCalcId(calc.id);
    }, [chart, onUpdate]);

    const handleUpdateCalculation = useCallback((calcId: string, updates: Partial<ChartCalculation>) => {
        onUpdate({
            ...chart,
            calculations: chart.calculations.map((c) => (c.id === calcId ? { ...c, ...updates } : c)),
        });
    }, [chart, onUpdate]);

    const handleRemoveCalculation = useCallback((calcId: string) => {
        onUpdate({ ...chart, calculations: chart.calculations.filter((c) => c.id !== calcId) });
    }, [chart, onUpdate]);

    const handleTypeChange = useCallback((type: ChartType) => {
        onUpdate({ ...chart, type });
    }, [chart, onUpdate]);

    const handleTitleChange = useCallback((title: string) => {
        onUpdate({ ...chart, title });
        setEditingTitle(false);
    }, [chart, onUpdate]);

    const chartMeasurements = useMemo(() => {
        const mpIds = new Set(chart.sources.map((s) => s.metricPointId).filter(Boolean));
        const relevantMps = metricPoints.filter((mp) => mpIds.has(mp.id));
        const deviceMetricKeys = new Set(relevantMps.map((mp) => `${mp.deviceId}:${mp.metricId}`));
        return measurements.filter((m) => deviceMetricKeys.has(`${m.deviceId}:${m.metricId}`));
    }, [chart.sources, measurements, metricPoints]);

    const existingMpIds = chart.sources.map((s) => s.metricPointId).filter(Boolean) as string[];

    return (
        <div className="bg-card border border-input rounded-lg overflow-visible">
            {/* Toolbar */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-input bg-muted/30 relative">
                {editingTitle ? (
                    <input
                        autoFocus
                        defaultValue={chart.title}
                        onBlur={(e) => handleTitleChange(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") handleTitleChange(e.currentTarget.value);
                            if (e.key === "Escape") setEditingTitle(false);
                        }}
                        className="text-sm font-medium bg-transparent border-b border-primary outline-none text-foreground"
                    />
                ) : (
                    <button
                        onClick={() => setEditingTitle(true)}
                        className="text-sm font-medium text-foreground hover:text-primary truncate"
                    >
                        {chart.title}
                    </button>
                )}

                <div className="mx-2 h-4 w-px bg-input" />

                <select
                    value={chart.type}
                    onChange={(e) => handleTypeChange(e.target.value as ChartType)}
                    className="text-xs bg-muted border border-input rounded px-2 py-1 text-foreground"
                >
                    {CHART_TYPES.map((ct) => (
                        <option key={ct.value} value={ct.value}>{ct.label}</option>
                    ))}
                </select>

                <div className="flex-1" />

                <ExportButton
                    chart={chart}
                    measurements={chartMeasurements}
                    metricPoints={metricPoints}
                    timeRange={timeRange}
                    chartContainerRef={chartContainerRef}
                />

                <button
                    onClick={onRemove}
                    className="text-muted-foreground hover:text-danger transition-colors"
                    title="Remove chart"
                >
                    <Trash2 className="w-4 h-4" />
                </button>
            </div>

            {/* Chart Area */}
            <div ref={chartContainerRef} style={{ height: chartHeight }}>
                {chart.type === "time_series" ? (
                    <TimeSeriesChart
                        chart={chart}
                        measurements={chartMeasurements}
                        metricPoints={metricPoints}
                        timeRange={timeRange}
                        compareRange={compareRange}
                        compareMeasurements={compareMeasurements}
                        bucketMinutes={bucketMinutes}
                    />
                ) : chart.type === "scatter" ? (
                    <ScatterChart chart={chart} timeRange={timeRange} />
                ) : chart.type === "boxplot" ? (
                    <BoxplotChart chart={chart} timeRange={timeRange} />
                ) : chart.type === "heatmap" ? (
                    <HeatmapChart chart={chart} timeRange={timeRange} />
                ) : chart.type === "histogram" ? (
                    <HistogramChart chart={chart} timeRange={timeRange} />
                ) : chart.type === "table" ? (
                    <StatsTable chart={chart} timeRange={timeRange} />
                ) : null}
            </div>

            {/* Resize handle */}
            <div
                onMouseDown={handleResizeStart}
                className={`h-1.5 cursor-row-resize hover:bg-primary/20 transition-colors ${resizing ? "bg-primary/30" : ""}`}
                title="Drag to resize"
            />

            {/* Source Tags + Calculation Tags */}
            <div className="flex items-center flex-wrap gap-2 px-3 py-2 border-t border-input bg-muted/20 relative">
                {/* Sensor tags */}
                {chart.sources.map((src) => (
                    <SourceTag
                        key={src.id}
                        source={src}
                        onRemove={() => handleRemoveSource(src.id)}
                        onColorChange={(color) => handleUpdateSource(src.id, { color })}
                    />
                ))}
                <div className="relative">
                    <button
                        onClick={() => { setShowPicker(!showPicker); setShowCalcPicker(false); }}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-primary hover:bg-primary/10 border border-dashed border-primary/40 transition-colors"
                    >
                        <Plus className="w-3 h-3" />
                        Sensor
                    </button>
                    {showPicker && (
                        <MetricPointPicker
                            metricPoints={metricPoints}
                            excludeIds={existingMpIds}
                            onSelect={handleAddSource}
                            onClose={() => setShowPicker(false)}
                        />
                    )}
                </div>

                {/* Divider */}
                {(chart.calculations.length > 0 || chart.sources.length > 0) && (
                    <div className="h-4 w-px bg-input mx-1" />
                )}

                {/* Calculation tags */}
                {chart.calculations.map((calc) => (
                    <div key={calc.id} className="relative">
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
                            <ColorSwatchPicker color={calc.color} onChange={(color) => handleUpdateCalculation(calc.id, { color })} />
                            <Calculator className="w-3 h-3" />
                            {calc.type === "formula" ? (
                                <button
                                    onClick={() => { setEditingCalcId(editingCalcId === calc.id ? null : calc.id); setShowPicker(false); setShowCalcPicker(false); }}
                                    className="font-mono hover:underline"
                                    title="Edit formula"
                                >
                                    {calc.label}
                                </button>
                            ) : (
                                calc.label
                            )}
                            <button onClick={() => handleRemoveCalculation(calc.id)} className="hover:text-danger ml-0.5">
                                <X className="w-3 h-3" />
                            </button>
                        </span>
                        {editingCalcId === calc.id && calc.type === "formula" && (
                            <FormulaCalcEditor
                                calc={calc}
                                sources={chart.sources}
                                onSave={(updates) => handleUpdateCalculation(calc.id, updates)}
                                onClose={() => setEditingCalcId(null)}
                            />
                        )}
                    </div>
                ))}
                <div className="relative">
                    <button
                        onClick={() => { setShowCalcPicker(!showCalcPicker); setShowPicker(false); }}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-primary hover:bg-primary/10 border border-dashed border-primary/40 transition-colors"
                    >
                        <Calculator className="w-3 h-3" />
                        Calc
                    </button>
                    {showCalcPicker && (
                        <CalculationPicker
                            sources={chart.sources}
                            calculations={chart.calculations}
                            onSelect={handleAddCalculation}
                            onClose={() => setShowCalcPicker(false)}
                        />
                    )}
                </div>

                {/* AI Analyze */}
                <AiAnalyzeButton
                    chart={chart}
                    timeRange={timeRange}
                    chartContainerRef={chartContainerRef}
                    metricPoints={metricPoints}
                    measurements={chartMeasurements}
                />
            </div>
        </div>
    );
}
