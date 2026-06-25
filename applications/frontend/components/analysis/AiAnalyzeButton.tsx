"use client";

import { useState, useCallback, type RefObject } from "react";
import { Sparkles, X, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import type { ChartDefinition } from "@/lib/api/analysis";
import type { Measurement, TimeRange } from "@/lib/api/types";
import type { ProjectMetricPoint } from "@/lib/api/projects";

interface AiAnalyzeButtonProps {
    chart: ChartDefinition;
    timeRange: TimeRange;
    chartContainerRef: RefObject<HTMLDivElement | null>;
    metricPoints: ProjectMetricPoint[];
    measurements: Measurement[];
}

interface AiAnalysisResult {
    analysis: string;
    recommendations: string[];
}

async function sendToAi(
    imageBase64: string,
    metadata: Record<string, unknown>,
): Promise<AiAnalysisResult> {
    return apiFetch<AiAnalysisResult>("/analysis-ai/analyze", {
        method: "POST",
        body: JSON.stringify({ image: imageBase64, metadata }),
    });
}

function captureCanvasFromDom(container: HTMLDivElement): string | null {
    const canvas = container.querySelector("canvas");
    if (canvas) return canvas.toDataURL("image/png").split(",")[1];
    return null;
}

function computeStats(values: number[]): { min: number; max: number; avg: number; latest: number; count: number } {
    if (values.length === 0) return { min: 0, max: 0, avg: 0, latest: 0, count: 0 };
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    return { min: +min.toFixed(2), max: +max.toFixed(2), avg: +avg.toFixed(2), latest: +values[values.length - 1].toFixed(2), count: values.length };
}

export function AiAnalyzeButton({ chart, timeRange, chartContainerRef, metricPoints, measurements }: AiAnalyzeButtonProps) {
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<AiAnalysisResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    const handleAnalyze = useCallback(async () => {
        setLoading(true);
        setError(null);
        setResult(null);

        try {
            const container = chartContainerRef.current;
            if (!container) throw new Error("Chart container not found");

            const base64 = captureCanvasFromDom(container);
            if (!base64) throw new Error("Could not capture chart image");

            // Build rich sensor context with actual data
            const sensorContext = chart.sources.map((src) => {
                const mp = metricPoints.find((m) => m.id === src.metricPointId);
                if (!mp) return { label: src.label };

                // Get actual values for this sensor
                const values = measurements
                    .filter((m) => m.deviceId === mp.deviceId && m.metricId === mp.metricId)
                    .map((m) => m.value)
                    .filter((v) => v != null) as number[];

                const stats = computeStats(values);

                return {
                    label: src.label,
                    color: src.color,
                    // Sensor identity
                    metricPointId: mp.id,
                    deviceId: mp.deviceId,
                    quantityName: mp.quantityName || null,
                    quantityDisplayName: mp.quantityDisplayName || null,
                    unit: mp.unit,
                    // Asset context
                    assetName: mp.assetName,
                    assetTypeName: mp.assetTypeName,
                    // Actual data statistics in the visible time range
                    dataStats: {
                        min: stats.min,
                        max: stats.max,
                        avg: stats.avg,
                        latest: stats.latest,
                        dataPoints: stats.count,
                    },
                };
            });

            const metadata = {
                chartTitle: chart.title,
                chartType: chart.type,
                timeRange: {
                    from: new Date(timeRange.from * 1000).toISOString(),
                    to: new Date(timeRange.to * 1000).toISOString(),
                    durationDays: Math.round((timeRange.to - timeRange.from) / 86400),
                },
                // Rich sensor context with actual values
                sensors: sensorContext,
                // Calculations applied
                calculations: chart.calculations.map((c) => ({
                    type: c.type,
                    label: c.label,
                    params: c.params,
                })),
                display: {
                    yAxes: chart.display.yAxes,
                    groupBy: chart.display.groupBy,
                },
            };

            const data = await sendToAi(base64, metadata);
            setResult(data);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Analysis failed");
        } finally {
            setLoading(false);
        }
    }, [chart, timeRange, chartContainerRef, metricPoints, measurements]);

    return (
        <>
            <button
                onClick={handleAnalyze}
                disabled={loading || chart.sources.length === 0}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-primary hover:bg-primary/10 border border-dashed border-primary/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title="AI Analysis — interpret this chart"
            >
                {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                AI
            </button>

            {(result || error) && (
                <div className="w-full mt-2 bg-muted/30 border border-input rounded-lg p-4 space-y-3">
                    <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2 text-sm font-medium text-primary">
                            <Sparkles className="w-4 h-4" />
                            AI Analysis
                        </div>
                        <button
                            onClick={() => { setResult(null); setError(null); }}
                            className="text-muted-foreground hover:text-foreground"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>

                    {error && <p className="text-sm text-danger">{error}</p>}

                    {result && (
                        <>
                            <p className="text-sm text-foreground whitespace-pre-wrap">{result.analysis}</p>
                            {result.recommendations.length > 0 && (
                                <div className="space-y-1">
                                    <p className="text-xs font-medium text-muted-foreground uppercase">Recommendations</p>
                                    <ul className="space-y-1">
                                        {result.recommendations.map((rec, i) => (
                                            <li key={i} className="text-sm text-foreground flex gap-2">
                                                <span className="text-primary shrink-0">→</span>
                                                {rec}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}
        </>
    );
}
