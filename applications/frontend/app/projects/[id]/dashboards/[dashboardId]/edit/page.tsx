"use client";

/**
 * Dashboard Editor Page — ADR-012 Phase 4.
 * Three-panel IDE-like layout: Asset Tree | Grid Preview | Widget Config.
 * Loads the dashboard, resolves scope, and provides drag-and-drop editing.
 */

import { use, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { IdeLayout } from "@/components/ide/IdeLayout";
import { EditorAssetTree } from "@/components/dashboard/editor/EditorAssetTree";
import { EditorGridPreview } from "@/components/dashboard/editor/EditorGridPreview";
import { EditorWidgetConfig } from "@/components/dashboard/editor/EditorWidgetConfig";
import { AddWidgetModal } from "@/components/dashboard/editor/AddWidgetModal";
import { SaveAsTemplateModal } from "@/components/dashboard/templates/SaveAsTemplateModal";
import { TemplatePickerModal } from "@/components/dashboard/templates/TemplatePickerModal";
import { DashboardAiModal } from "@/components/dashboard/editor/DashboardAiModal";
import { abstractLayout } from "@/components/dashboard/templates/abstractLayout";
import { resolveTemplate } from "@/components/dashboard/templates/resolveTemplate";
import type { DashboardTemplateDTO } from "@/lib/api/dashboard-templates";
import { useEditorState } from "@/components/dashboard/editor/useEditorState";
import { useDashboard, useDashboards } from "@/lib/hooks/useDashboards";
import { useDashboardTemplates } from "@/lib/hooks/useDashboardTemplates";
import { useProject, useProjectGraph } from "@/lib/hooks/useProjects";
import { updateDashboard } from "@/lib/api/dashboards";
import { getMetricPoints } from "@/lib/api/metric-points";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { Button } from "@/components/ui/Button";
import { ArrowLeft, Save, RotateCcw, Check, Pencil, X, BookmarkPlus, LayoutTemplate, Sparkles } from "lucide-react";
import type { MetricPoint } from "@/lib/api/metric-points";

interface EditorPageProps {
    params: Promise<{ id: string; dashboardId: string }>;
}

export default function DashboardEditorPage({ params }: EditorPageProps) {
    const { id: projectId, dashboardId } = use(params);
    const router = useRouter();
    const { dashboard, loading: dashboardLoading, refresh: refreshDashboard } = useDashboard(dashboardId);
    const { project } = useProject(projectId);
    const graph = useProjectGraph(projectId);
    const { create: createTemplate } = useDashboardTemplates();

    const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
    const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
    const [applyingTemplate, setApplyingTemplate] = useState(false);
    const [aiModalOpen, setAiModalOpen] = useState(false);

    const editor = useEditorState({
        dashboard,
        objects: graph.objects,
        links: graph.links,
    });

    const [saving, setSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [addWidgetModalOpen, setAddWidgetModalOpen] = useState(false);

    // ─── Save handler ────────────────────────────────────────────────────────

    const handleSave = useCallback(async () => {
        setSaving(true);
        setSaveSuccess(false);
        try {
            await updateDashboard(dashboardId, {
                layout: JSON.stringify(editor.layout),
            });
            editor.setDirty(false);
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 2000);
            refreshDashboard();
        } catch (e) {
            alert(e instanceof Error ? e.message : "Failed to save dashboard");
        } finally {
            setSaving(false);
        }
    }, [dashboardId, editor, refreshDashboard]);

    // ─── Save as Template handler ───────────────────────────────────────────

    const handleSaveAsTemplate = useCallback(async (name: string) => {
        if (!project?.tenantId) throw new Error("No tenant context");

        // Collect all unique assetIds used in widgets
        const assetIds = new Set<string>();
        for (const w of editor.layout.widgets) {
            if (w.config.assetId) assetIds.add(w.config.assetId);
            if (w.config.series) {
                for (const s of w.config.series) {
                    if (s.assetId) assetIds.add(s.assetId);
                }
            }
        }

        // Fetch metric points for all referenced objects
        const metricsByObject = new Map<string, MetricPoint[]>();
        await Promise.all(
            Array.from(assetIds).map(async (id) => {
                try {
                    const metrics = await getMetricPoints(id);
                    metricsByObject.set(id, metrics);
                } catch { /* skip */ }
            })
        );

        // Abstract the layout
        const abstractedLayout = abstractLayout(editor.layout, {
            objects: graph.objects,
            metricsByObject,
        });

        // Save as template
        await createTemplate(name, JSON.stringify(abstractedLayout), project.tenantId);
    }, [editor.layout, graph.objects, project, createTemplate]);

    // ─── Apply Template handler ──────────────────────────────────────────────

    const DEVICE_CATEGORIES = new Set(["DEVICE", "SENSOR", "ACTUATOR", "CONTROLLER", "GATEWAY", "METER"]);

    const handleApplyTemplate = useCallback(async (template: DashboardTemplateDTO) => {
        setApplyingTemplate(true);
        try {
            const templateLayout = JSON.parse(template.layout);

            // Fetch metric points for all device-category objects in the project
            const deviceObjects = graph.objects.filter(o => DEVICE_CATEGORIES.has(o.objectTypeCategory));
            const metricsByObject = new Map<string, MetricPoint[]>();
            await Promise.all(
                deviceObjects.map(async (obj) => {
                    try {
                        const metrics = await getMetricPoints(obj.id);
                        metricsByObject.set(obj.id, metrics);
                    } catch { /* skip */ }
                })
            );

            // Resolve template against actual devices
            const { layout } = resolveTemplate(templateLayout, {
                objects: graph.objects,
                metricsByObject,
            });

            // Apply resolved layout to the editor
            editor.applyTemplate(layout);
            setTemplatePickerOpen(false);
        } catch (e) {
            alert(e instanceof Error ? e.message : "Failed to apply template");
        } finally {
            setApplyingTemplate(false);
        }
    }, [graph.objects, editor]);

    // ─── Loading state ───────────────────────────────────────────────────────

    if (dashboardLoading || (graph.loading && graph.objects.length === 0)) {
        return (
            <div className="fixed inset-0 z-50 bg-background flex items-center justify-center">
                <LoadingSpinner size="lg" />
            </div>
        );
    }

    if (!dashboard) {
        return (
            <div className="fixed inset-0 z-50 bg-background flex flex-col items-center justify-center gap-4">
                <p className="text-sm text-danger">Dashboard not found.</p>
                <Button variant="ghost" size="sm" onClick={() => router.back()}>
                    <ArrowLeft className="h-4 w-4 mr-1.5" /> Go Back
                </Button>
            </div>
        );
    }

    // Scope label for the asset tree
    const scopeLabel = dashboard.scopeType
        ? `${dashboard.scopeType} scope`
        : "Project-wide";

    // ─── Render ──────────────────────────────────────────────────────────────

    return (
        <div className="fixed inset-0 z-50 bg-background">
            <IdeLayout
                left={
                    <EditorAssetTree
                        objects={editor.scopedObjects}
                        projectId={projectId}
                        scopeLabel={scopeLabel}
                    />
                }
                center={
                    <EditorGridPreview
                        layout={editor.layout}
                        selectedWidgetId={editor.selectedWidgetId}
                        onSelectWidget={editor.setSelectedWidgetId}
                        onDropAsset={editor.addWidget}
                        onRemoveWidget={editor.removeWidget}
                        onMoveWidget={editor.moveWidget}
                        onSetColumns={editor.setColumns}
                        onAddWidgetClick={() => setAddWidgetModalOpen(true)}
                        onApplyTemplate={() => setTemplatePickerOpen(true)}
                        onAiAssistant={() => setAiModalOpen(true)}
                    />
                }
                right={
                    <EditorWidgetConfig
                        widget={editor.selectedWidget}
                        scopedObjects={editor.scopedObjects}
                        onUpdateWidget={editor.updateWidget}
                        onUpdateConfig={editor.updateWidgetConfig}
                        onUpdatePosition={editor.updateWidgetPosition}
                        onDuplicate={editor.duplicateWidget}
                        onRemove={editor.removeWidget}
                        maxColumns={editor.layout.columns}
                    />
                }
                statusBar={
                    <EditorStatusBar
                        projectId={projectId}
                        dashboardName={dashboard.name}
                        dashboardId={dashboardId}
                        dirty={editor.dirty}
                        saving={saving}
                        saveSuccess={saveSuccess}
                        widgetCount={editor.layout.widgets.length}
                        onBack={() => router.push(`/projects/${projectId}`)}
                        onSave={handleSave}
                        onDiscard={editor.resetLayout}
                        onSaveAsTemplate={() => setSaveTemplateOpen(true)}
                        onApplyTemplate={() => setTemplatePickerOpen(true)}
                        onAiAssistant={() => setAiModalOpen(true)}
                    />
                }
            />

            <AddWidgetModal
                open={addWidgetModalOpen}
                onClose={() => setAddWidgetModalOpen(false)}
                onSelect={(type) => editor.addWidgetByType(type)}
            />

            <SaveAsTemplateModal
                open={saveTemplateOpen}
                onClose={() => setSaveTemplateOpen(false)}
                widgetCount={editor.layout.widgets.length}
                onSave={handleSaveAsTemplate}
            />

            <TemplatePickerModal
                open={templatePickerOpen}
                onClose={() => setTemplatePickerOpen(false)}
                onApply={handleApplyTemplate}
                applying={applyingTemplate}
            />

            <DashboardAiModal
                open={aiModalOpen}
                onClose={() => setAiModalOpen(false)}
                projectId={projectId}
                onApply={(layout) => { editor.applyTemplate(layout); setAiModalOpen(false); }}
                hasExistingWidgets={editor.layout.widgets.length > 0}
            />
        </div>
    );
}

// ─── Status bar ──────────────────────────────────────────────────────────────

function EditorStatusBar({
    projectId,
    dashboardName,
    dashboardId,
    dirty,
    saving,
    saveSuccess,
    widgetCount,
    onBack,
    onSave,
    onDiscard,
    onSaveAsTemplate,
    onApplyTemplate,
    onAiAssistant,
}: {
    projectId: string;
    dashboardName: string;
    dashboardId: string;
    dirty: boolean;
    saving: boolean;
    saveSuccess: boolean;
    widgetCount: number;
    onBack: () => void;
    onSave: () => void;
    onDiscard: () => void;
    onSaveAsTemplate: () => void;
    onApplyTemplate: () => void;
    onAiAssistant: () => void;
}) {
    const { update } = useDashboards(projectId);
    const [editingName, setEditingName] = useState(false);
    const [nameValue, setNameValue] = useState(dashboardName);
    const [savingName, setSavingName] = useState(false);

    const handleSaveName = useCallback(async () => {
        if (!nameValue.trim() || nameValue.trim() === dashboardName) {
            setEditingName(false);
            return;
        }
        setSavingName(true);
        try {
            await update(dashboardId, { name: nameValue.trim() });
            setEditingName(false);
        } catch { /* handled upstream */ }
        finally { setSavingName(false); }
    }, [nameValue, dashboardName, dashboardId, update]);

    return (
        <div className="flex items-center gap-3 w-full">
            {/* Back */}
            <button
                onClick={onBack}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
                <ArrowLeft className="h-3 w-3" />
                Back to Dashboard
            </button>

            <span className="text-border">·</span>

            {/* Dashboard name */}
            {editingName ? (
                <div className="flex items-center gap-1">
                    <input
                        value={nameValue}
                        onChange={(e) => setNameValue(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") handleSaveName();
                            if (e.key === "Escape") { setEditingName(false); setNameValue(dashboardName); }
                        }}
                        autoFocus
                        className="h-5 px-1.5 text-xs font-medium bg-background border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <button onClick={handleSaveName} disabled={savingName} className="p-0.5 rounded text-primary hover:bg-primary/10">
                        <Check className="h-3 w-3" />
                    </button>
                    <button onClick={() => { setEditingName(false); setNameValue(dashboardName); }} className="p-0.5 rounded text-muted-foreground hover:bg-muted">
                        <X className="h-3 w-3" />
                    </button>
                </div>
            ) : (
                <button
                    onClick={() => setEditingName(true)}
                    className="flex items-center gap-1 text-xs font-medium text-foreground hover:text-primary transition-colors group"
                >
                    {dashboardName}
                    <Pencil className="h-2.5 w-2.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
            )}

            <span className="text-border">·</span>
            <span className="text-xs">{widgetCount} widget{widgetCount !== 1 ? "s" : ""}</span>

            {/* Dirty indicator */}
            {dirty && (
                <>
                    <span className="text-border">·</span>
                    <span className="flex items-center gap-1 text-xs text-amber-500">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        Unsaved
                    </span>
                </>
            )}

            {saveSuccess && (
                <>
                    <span className="text-border">·</span>
                    <span className="flex items-center gap-1 text-xs text-emerald-500">
                        <Check className="h-3 w-3" />
                        Saved
                    </span>
                </>
            )}

            {/* Spacer */}
            <div className="flex-1" />

            {/* Actions */}
            <button
                onClick={onAiAssistant}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
                <Sparkles className="h-3 w-3" />
                AI Assistant
            </button>
            <button
                onClick={onApplyTemplate}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
                <LayoutTemplate className="h-3 w-3" />
                Apply Template
            </button>
            {widgetCount > 0 && (
                <button
                    onClick={onSaveAsTemplate}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                    <BookmarkPlus className="h-3 w-3" />
                    Save as Template
                </button>
            )}
            {dirty && (
                <button
                    onClick={onDiscard}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                    <RotateCcw className="h-3 w-3" />
                    Discard
                </button>
            )}
            <button
                onClick={onSave}
                disabled={saving || !dirty}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
                <Save className="h-3 w-3" />
                {saving ? "Saving..." : "Save"}
            </button>
        </div>
    );
}
