"use client";

import { useState, useMemo, useCallback } from "react";
import useSWR from "swr";
import { X, FileText, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { listAnalysisTemplates } from "@/lib/api/analysis";
import type { AnalysisTemplate, CanvasDefinition, ChartSource } from "@/lib/api/analysis";
import type { ProjectMetricPoint } from "@/lib/api/projects";

interface TemplatePickerProps {
    metricPoints: ProjectMetricPoint[];
    onApply: (canvas: CanvasDefinition) => void;
    onClose: () => void;
}

interface SourceBinding {
    sourceId: string;
    label: string;
    quantityName: string;
    required: boolean;
    mappedMetricPointId: string | null;
}

function autoMatchMetricPoint(
    binding: { quantityName: string },
    metricPoints: ProjectMetricPoint[],
    alreadyUsed: Set<string>,
): string | null {
    const match = metricPoints.find(
        (mp) =>
            !alreadyUsed.has(mp.id) &&
            (mp.quantityName === binding.quantityName ||
                mp.displayName?.toLowerCase().includes(binding.quantityName.replace(/_/g, " ")))
    );
    return match?.id ?? null;
}

export function TemplatePicker({ metricPoints, onApply, onClose }: TemplatePickerProps) {
    const { data } = useSWR("analysis-templates", () => listAnalysisTemplates(), { revalidateOnFocus: false });
    const templates = data?.analysisTemplates ?? [];

    const [selectedTemplate, setSelectedTemplate] = useState<AnalysisTemplate | null>(null);
    const [bindings, setBindings] = useState<SourceBinding[]>([]);

    const handleSelectTemplate = useCallback((template: AnalysisTemplate) => {
        setSelectedTemplate(template);

        // Parse definition and extract abstract bindings
        try {
            const def = JSON.parse(template.definition) as CanvasDefinition;
            const sources: SourceBinding[] = [];
            const used = new Set<string>();

            for (const chart of def.charts) {
                for (const src of chart.sources) {
                    if (src.binding) {
                        const autoMatch = autoMatchMetricPoint(src.binding, metricPoints, used);
                        if (autoMatch) used.add(autoMatch);
                        sources.push({
                            sourceId: src.id,
                            label: src.label,
                            quantityName: src.binding.quantityName,
                            required: src.binding.required,
                            mappedMetricPointId: autoMatch,
                        });
                    }
                }
            }
            setBindings(sources);
        } catch {
            setBindings([]);
        }
    }, [metricPoints]);

    const handleBindingChange = useCallback((sourceId: string, metricPointId: string) => {
        setBindings((prev) =>
            prev.map((b) => (b.sourceId === sourceId ? { ...b, mappedMetricPointId: metricPointId } : b))
        );
    }, []);

    const handleApply = useCallback(() => {
        if (!selectedTemplate) return;
        try {
            const def = JSON.parse(selectedTemplate.definition) as CanvasDefinition;

            // Replace abstract bindings with concrete metricPointIds
            for (const chart of def.charts) {
                for (const src of chart.sources) {
                    const binding = bindings.find((b) => b.sourceId === src.id);
                    if (binding?.mappedMetricPointId) {
                        src.metricPointId = binding.mappedMetricPointId;
                        delete (src as any).binding;
                    }
                }
            }

            onApply(def);
        } catch {
            console.error("Failed to apply template");
        }
    }, [selectedTemplate, bindings, onApply]);

    const allRequiredMapped = bindings
        .filter((b) => b.required)
        .every((b) => b.mappedMetricPointId);

    if (selectedTemplate) {
        return (
            <div className="absolute z-50 top-full left-0 mt-1 w-128 bg-card border border-input rounded-lg shadow-lg overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-input">
                    <button onClick={() => setSelectedTemplate(null)} className="text-sm text-primary hover:underline">
                        Back
                    </button>
                    <span className="text-sm font-medium text-foreground">{selectedTemplate.name}</span>
                    <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {selectedTemplate.description && (
                    <p className="px-3 py-2 text-xs text-muted-foreground border-b border-input">
                        {selectedTemplate.description}
                    </p>
                )}

                <div className="p-3 space-y-3">
                    <p className="text-xs font-medium text-muted-foreground uppercase">Map Sensors</p>
                    {bindings.map((binding) => (
                        <div key={binding.sourceId} className="flex items-center gap-2">
                            <span className="text-sm text-foreground w-32 truncate">
                                {binding.label}
                                {binding.required && <span className="text-danger ml-0.5">*</span>}
                            </span>
                            <select
                                value={binding.mappedMetricPointId || ""}
                                onChange={(e) => handleBindingChange(binding.sourceId, e.target.value)}
                                className="flex-1 text-xs bg-muted border border-input rounded px-2 py-1.5 text-foreground"
                            >
                                <option value="">— Select —</option>
                                {metricPoints.map((mp) => (
                                    <option key={mp.id} value={mp.id}>
                                        {mp.assetName} / {mp.quantityDisplayName || mp.displayName || `Metric ${mp.metricId}`}
                                    </option>
                                ))}
                            </select>
                        </div>
                    ))}

                    {bindings.length === 0 && (
                        <p className="text-xs text-muted-foreground">No sensor mappings needed</p>
                    )}
                </div>

                <div className="px-3 py-2 border-t border-input">
                    <Button size="sm" onClick={handleApply} disabled={!allRequiredMapped} fullWidth>
                        Apply Template
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="absolute z-50 top-full left-0 mt-1 w-80 bg-card border border-input rounded-lg shadow-lg overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-input">
                <span className="text-xs font-medium text-muted-foreground uppercase">Templates</span>
                <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
                    <X className="w-4 h-4" />
                </button>
            </div>
            <div className="max-h-64 overflow-y-auto p-1">
                {templates.length === 0 ? (
                    <p className="px-3 py-4 text-sm text-muted-foreground text-center">No templates available</p>
                ) : (
                    templates.map((t) => (
                        <button
                            key={t.id}
                            onClick={() => handleSelectTemplate(t)}
                            className="w-full text-left px-3 py-2 rounded hover:bg-muted transition-colors flex items-center gap-2"
                        >
                            <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                            <div className="flex-1 min-w-0">
                                <div className="text-sm text-foreground truncate">{t.name}</div>
                                {t.description && (
                                    <div className="text-xs text-muted-foreground truncate">{t.description}</div>
                                )}
                            </div>
                            {t.isSystem && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary shrink-0">System</span>
                            )}
                            <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
                        </button>
                    ))
                )}
            </div>
        </div>
    );
}
