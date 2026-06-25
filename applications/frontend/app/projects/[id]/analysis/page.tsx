/**
 * Analysis Canvas Page — Live analysis workspace for energy consultants.
 * Thin orchestrator: wires useAnalysisCanvas hook to UI components.
 */

"use client";

import { use, useState } from "react";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/Button";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { AnalysisCanvas } from "@/components/analysis/AnalysisCanvas";
import { ViewSelector } from "@/components/analysis/ViewSelector";
import { TemplatePicker } from "@/components/analysis/TemplatePicker";
import { SaveAsTemplateDialog } from "@/components/analysis/SaveAsTemplateDialog";
import { useProject } from "@/lib/hooks/useProjects";
import { useAnalysisCanvas } from "@/lib/hooks/useAnalysisCanvas";
import type { CanvasDefinition } from "@/lib/api/analysis";
import { Save, Trash2, FileInput, FileOutput } from "lucide-react";

interface AnalysisPageProps {
    params: Promise<{ id: string }>;
}

export default function ProjectAnalysisPage({ params }: AnalysisPageProps) {
    const { id: projectId } = use(params);
    const { project } = useProject(projectId);
    const [showTemplatePicker, setShowTemplatePicker] = useState(false);
    const [showSaveTemplate, setShowSaveTemplate] = useState(false);

    const {
        canvas, updateCanvas,
        metricPoints, metricPointsLoaded,
        measurements, measLoading,
        timePreset, setTimePreset, timeRange,
        customRange, setCustomRange,
        compareRange, setCompareRange, compareMeasurements,
        bucketMinutes, setBucketMinutes,
        activeViewId, viewName, renameView,
        dirty, saving, savedViews,
        save, loadView, newAnalysis, deleteView,
    } = useAnalysisCanvas(projectId);

    const handleApplyTemplate = (def: CanvasDefinition) => {
        updateCanvas(def);
        setShowTemplatePicker(false);
    };

    return (
        <div className="min-h-screen bg-background">
            <Header
                title="Analysis"
                subtitle={project?.name}
                breadcrumbs={[
                    { label: "Projects", href: "/projects" },
                    { label: project?.name || "Project", href: `/projects/${projectId}` },
                    { label: "Analysis" },
                ]}
            />

            <div className="p-4 md:p-6 space-y-4">
                {/* Header: View selector + template actions + save */}
                <div className="flex items-center gap-3 flex-wrap">
                    <ViewSelector
                        viewName={viewName}
                        activeViewId={activeViewId}
                        savedViews={savedViews}
                        onRename={renameView}
                        onLoad={loadView}
                        onNew={newAnalysis}
                    />

                    {/* Template buttons */}
                    <div className="relative">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => { setShowTemplatePicker(!showTemplatePicker); setShowSaveTemplate(false); }}
                        >
                            <FileInput className="w-4 h-4 mr-1" />
                            From Template
                        </Button>
                        {showTemplatePicker && (
                            <TemplatePicker
                                metricPoints={metricPoints}
                                onApply={handleApplyTemplate}
                                onClose={() => setShowTemplatePicker(false)}
                            />
                        )}
                    </div>

                    <div className="relative">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => { setShowSaveTemplate(!showSaveTemplate); setShowTemplatePicker(false); }}
                            disabled={canvas.charts.length === 0}
                        >
                            <FileOutput className="w-4 h-4 mr-1" />
                            Save as Template
                        </Button>
                        {showSaveTemplate && (
                            <SaveAsTemplateDialog
                                canvas={canvas}
                                onClose={() => setShowSaveTemplate(false)}
                                onSaved={() => {}}
                            />
                        )}
                    </div>

                    <div className="flex-1" />

                    {activeViewId && (
                        <Button variant="ghost" size="sm" onClick={deleteView} className="text-muted-foreground hover:text-danger">
                            <Trash2 className="w-4 h-4" />
                        </Button>
                    )}

                    <Button variant="primary" size="sm" onClick={save} loading={saving} disabled={!dirty && !!activeViewId}>
                        <Save className="w-4 h-4 mr-1" />
                        {activeViewId ? "Save" : "Save as new"}
                    </Button>
                </div>

                {/* Canvas */}
                {!metricPointsLoaded ? (
                    <div className="flex items-center justify-center py-20">
                        <LoadingSpinner />
                    </div>
                ) : (
                    <AnalysisCanvas
                        metricPoints={metricPoints}
                        measurements={measurements}
                        isLoading={measLoading}
                        canvas={canvas}
                        onCanvasChange={updateCanvas}
                        timePreset={timePreset}
                        onTimePresetChange={setTimePreset}
                        timeRange={timeRange}
                        customRange={customRange}
                        onCustomRangeChange={setCustomRange}
                        compareRange={compareRange}
                        onCompareRangeChange={setCompareRange}
                        compareMeasurements={compareMeasurements}
                        bucketMinutes={bucketMinutes}
                        onBucketChange={setBucketMinutes}
                    />
                )}
            </div>
        </div>
    );
}
