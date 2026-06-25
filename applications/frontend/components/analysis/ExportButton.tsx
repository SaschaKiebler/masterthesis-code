"use client";

import { useState, type RefObject } from "react";
import { Download, FileSpreadsheet, Image } from "lucide-react";
import type { Measurement, TimeRange } from "@/lib/api/types";
import type { ChartDefinition } from "@/lib/api/analysis";
import type { ProjectMetricPoint } from "@/lib/api/projects";

interface ExportButtonProps {
    chart: ChartDefinition;
    measurements: Measurement[];
    metricPoints: ProjectMetricPoint[];
    timeRange: TimeRange;
    chartContainerRef: RefObject<HTMLDivElement | null>;
}

function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function exportCSV(chart: ChartDefinition, measurements: Measurement[], metricPoints: ProjectMetricPoint[]) {
    const mpMap = new Map(metricPoints.map((mp) => [`${mp.deviceId}:${mp.metricId}`, mp]));
    const sourceMap = new Map(chart.sources.map((s) => [s.metricPointId, s]));

    const relevant = measurements.filter((m) => {
        const mp = mpMap.get(`${m.deviceId}:${m.metricId}`);
        return mp && sourceMap.has(mp.id);
    });

    const rows: string[] = ["time,sensor,value,unit"];
    for (const m of relevant) {
        const mp = mpMap.get(`${m.deviceId}:${m.metricId}`);
        if (!mp) continue;
        const src = sourceMap.get(mp.id);
        const time = new Date(m.time * 1000).toISOString();
        const name = src?.label || mp.displayName || `${m.deviceId}:${m.metricId}`;
        rows.push(`${time},"${name}",${m.value},${mp.unit || ""}`);
    }

    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
    downloadBlob(blob, `${chart.title.replace(/[^a-zA-Z0-9]/g, "_")}_export.csv`);
}

function exportPNG(container: HTMLDivElement | null, title: string) {
    if (!container) return;
    const canvas = container.querySelector("canvas");
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `${title.replace(/[^a-zA-Z0-9]/g, "_")}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

export function ExportButton({ chart, measurements, metricPoints, timeRange, chartContainerRef }: ExportButtonProps) {
    const [open, setOpen] = useState(false);

    return (
        <div className="relative">
            <button
                onClick={() => setOpen(!open)}
                className="text-muted-foreground hover:text-foreground transition-colors"
                title="Export"
            >
                <Download className="w-4 h-4" />
            </button>

            {open && (
                <div className="absolute z-50 bottom-full right-0 mb-1 w-40 bg-card border border-input rounded-lg shadow-lg overflow-hidden">
                    <button
                        onClick={() => { exportCSV(chart, measurements, metricPoints); setOpen(false); }}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors flex items-center gap-2"
                    >
                        <FileSpreadsheet className="w-4 h-4" />
                        Export CSV
                    </button>
                    <button
                        onClick={() => { exportPNG(chartContainerRef.current, chart.title); setOpen(false); }}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors flex items-center gap-2"
                    >
                        <Image className="w-4 h-4" />
                        Export PNG
                    </button>
                </div>
            )}
        </div>
    );
}
