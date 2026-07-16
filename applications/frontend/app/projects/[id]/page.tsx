"use client";

/**
 * Monitor Page (ADR-012 Phase 3)
 * The operational dashboard view for a project.
 */

import { use, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/Button";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { useProject, useProjectGraph } from "@/lib/hooks/useProjects";
import { useDashboards } from "@/lib/hooks/useDashboards";
import { useProjectHealth } from "@/lib/hooks/useProjectHealth";
import { useProjectKpis } from "@/lib/hooks/useProjectKpis";
import { useIngestRate } from "@/lib/hooks/useIngestRate";
import { getProjectEvents } from "@/lib/api/projects";
import { SynopticView } from "@/components/graph/SynopticView";
import { LogEventModal } from "@/components/events/LogEventModal";
import {
    Wrench, Building2, Pencil, BarChart3,
    Plus, LayoutDashboard, Gauge, Trash2, Activity, Radio, Wifi, AlertTriangle,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { DashboardRenderer } from "@/components/dashboard/DashboardRenderer";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { TemplatePickerModal } from "@/components/dashboard/templates/TemplatePickerModal";
import { resolveTemplate } from "@/components/dashboard/templates/resolveTemplate";
import { getMetricPoints } from "@/lib/api/metric-points";
import { updateDashboard } from "@/lib/api/dashboards";
import type { TimeRange } from "@/lib/api/types";
import type { DashboardTemplateDTO } from "@/lib/api/dashboard-templates";
import type { MetricPoint } from "@/lib/api/metric-points";
import { ActionBarButton } from "@/components/projects/ActionBarButton";
import { KpiQualityBadge } from "@/components/projects/KpiQualityBadge";
import { RecentEventsList } from "@/components/projects/RecentEventsList";
import type { TimePreset } from "@/types";

interface MonitorPageProps {
    params: Promise<{ id: string }>;
}

const PRESET_SECONDS: Record<string, number> = {
    "1h": 3600,
    "6h": 6 * 3600,
    "24h": 24 * 3600,
    "3d": 3 * 86400,
    "7d": 7 * 86400,
};

const DEVICE_CATEGORIES = new Set(["DEVICE", "SENSOR", "ACTUATOR", "CONTROLLER", "GATEWAY", "METER"]);

export default function MonitorPage({ params }: MonitorPageProps) {
    const { id: projectId } = use(params);
    const router = useRouter();

    const { project, loading: projectLoading, error: projectError } = useProject(projectId);
    const { dashboards, loading: dashboardsLoading, create: createDashboard, remove: removeDashboard, refresh: refreshDashboards } = useDashboards(projectId);
    const { objects: graphObjects, links: graphLinks, loading: graphLoading } = useProjectGraph(projectId);
    
    // Time range state
    const [preset, setPreset] = useState<TimePreset>("24h");
    const [customFrom, setCustomFrom] = useState("");
    const [customTo, setCustomTo] = useState("");
    const [live, setLive] = useState(true);
    const [offset, setOffset] = useState(0); // steps back from now

    // Convert preset to absolute timestamps for queries
    const timeRange = useMemo<TimeRange | undefined>(() => {
        if (preset === "custom") {
            const f = new Date(customFrom).getTime();
            const t = new Date(customTo).getTime();
            if (!isNaN(f) && !isNaN(t)) {
                return { from: Math.floor(f / 1000), to: Math.floor(t / 1000) };
            }
            return undefined;
        }
        const stepSec = PRESET_SECONDS[preset];
        if (!stepSec) return undefined;
        const nowSec = Math.floor(Date.now() / 1000);
        const toSec = nowSec - offset * stepSec;
        return { from: toSec - stepSec, to: toSec };
    }, [preset, customFrom, customTo, offset]);

    // Project health: device-level connectivity per building
    const { health: projectHealth } = useProjectHealth(projectId);
    const { rate: ingestRate } = useIngestRate(projectId);

    // Project KPIs: formulas from all objects in the project
    const { kpis: projectKpis, isLoading: kpisLoading } = useProjectKpis(graphObjects);

    // Recent events for overview tab
    const { data: eventsData, mutate: mutateEvents } = useSWR(
        projectId ? ["project-events-overview", projectId] : null,
        async () => {
            const nowSec = Math.floor(Date.now() / 1000);
            return getProjectEvents(projectId, {
                from: nowSec - 30 * 86400,
                to: nowSec,
                limit: 8,
            });
        },
        { revalidateOnFocus: false }
    );
    const recentEvents = eventsData?.events ?? [];

    // Log Event modal
    const [showLogEvent, setShowLogEvent] = useState(false);

    // Active tab state
    const [activeTab, setActiveTab] = useState<string>("overview");
    const [creatingDashboard, setCreatingDashboard] = useState(false);

    // Delete dashboard state
    const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);

    async function handleDeleteDashboard() {
        if (!deleteTarget) return;
        setDeleting(true);
        setDeleteError(null);
        try {
            await removeDashboard(deleteTarget.id);
            if (activeTab === deleteTarget.id) setActiveTab("overview");
            setDeleteTarget(null);
        } catch (e) {
            setDeleteError(e instanceof Error ? e.message : "Failed to delete dashboard");
        } finally {
            setDeleting(false);
        }
    }

    // Template picker state
    const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
    const [templatePickerDashboardId, setTemplatePickerDashboardId] = useState<string | null>(null);
    const [applyingTemplate, setApplyingTemplate] = useState(false);

    async function handleApplyTemplate(template: DashboardTemplateDTO) {
        const dashboardId = templatePickerDashboardId;
        if (!dashboardId) return;
        setApplyingTemplate(true);
        try {
            const templateLayout = JSON.parse(template.layout);

            // Fetch metric points for all device-category objects in the project
            const deviceObjects = graphObjects.filter(o => DEVICE_CATEGORIES.has(o.objectTypeCategory));
            const metricsByObject = new Map<string, MetricPoint[]>();
            await Promise.all(
                deviceObjects.map(async (obj) => {
                    try {
                        const metrics = await getMetricPoints(obj.id);
                        metricsByObject.set(obj.id, metrics);
                    } catch { /* skip objects without metrics */ }
                })
            );

            // Resolve template against actual devices
            const { layout } = resolveTemplate(templateLayout, {
                objects: graphObjects,
                metricsByObject,
            });

            // Save resolved layout to the dashboard
            await updateDashboard(dashboardId, { layout: JSON.stringify(layout) });

            // Refresh dashboards list
            refreshDashboards();
            setTemplatePickerOpen(false);
            setTemplatePickerDashboardId(null);
        } catch (e) {
            alert(e instanceof Error ? e.message : "Failed to apply template");
        } finally {
            setApplyingTemplate(false);
        }
    }

    if (projectLoading || dashboardsLoading || graphLoading) {
        return (
            <div className="min-h-screen bg-background">
                <Header title="Loading Dashboard..." />
                <div className="flex justify-center py-20"><LoadingSpinner size="lg" /></div>
            </div>
        );
    }

    if (projectError || !project) {
        return (
            <div className="min-h-screen bg-background">
                <Header title="Project Dashboard" />
                <div className="p-4 md:p-8">
                    <ErrorMessage title="Failed to load project" message={projectError || "Not found"} />
                </div>
            </div>
        );
    }

    const totals = projectHealth?.totals;
    const totalBuildings = totals?.buildings ?? 0;
    const totalDevices = totals?.devices ?? 0;
    const totalOnline = totals?.online ?? 0;
    const totalIssues = (totals?.stale ?? 0) + (totals?.offline ?? 0);

    // Find the currently active dashboard
    const activeDashboard = dashboards.find(d => d.id === activeTab);

    return (
        <div className="min-h-screen bg-background flex flex-col">
            <Header
                title={project.name}
                subtitle={`${totalBuildings} buildings · ${totalDevices} devices · ${dashboards.length} dashboards`}
                breadcrumbs={[
                    { label: "Dashboard", href: "/" },
                    { label: "Projects", href: "/projects" },
                    { label: project.name },
                ]}
            />

            {/* ── Central Action Bar ─────────────────────────────────────── */}
            <div className="border-b border-border bg-card/50">
                <div className="px-4 md:px-8 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <ActionBarButton
                            icon={Wrench}
                            label="Configure"
                            description="Add buildings, sensors & connections"
                            onClick={() => router.push(`/projects/${projectId}/ide`)}
                            primary
                        />
                        <ActionBarButton
                            icon={BarChart3}
                            label="Analysis"
                            description="Historical data & deep-dive"
                            onClick={() => router.push(`/projects/${projectId}/analysis`)}
                        />
                        <ActionBarButton
                            icon={LayoutDashboard}
                            label={creatingDashboard ? "Creating..." : "New Dashboard"}
                            description="Create a monitoring view"
                            onClick={async () => {
                                if (creatingDashboard) return;
                                setCreatingDashboard(true);
                                try {
                                    const dashboard = await createDashboard({ name: `Dashboard ${dashboards.length + 1}` });
                                    router.push(`/projects/${projectId}/dashboards/${dashboard.id}/edit`);
                                } catch {
                                    setCreatingDashboard(false);
                                }
                            }}
                        />
                        <ActionBarButton
                            icon={Gauge}
                            label="Add Sensor"
                            description="Add a sensor to this project"
                            onClick={() => router.push(`/projects/${projectId}/ide?action=add-sensor`)}
                        />
                    </div>
                </div>
            </div>

            <div className="flex-1 p-4 md:p-8 space-y-6 overflow-y-auto flex flex-col">
                {/* Dashboard Tabs */}
                <div className="flex gap-2 border-b border-border overflow-x-auto pb-px">
                    <button
                        onClick={() => setActiveTab("overview")}
                        className={`px-4 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                            activeTab === "overview"
                                ? "border-primary text-primary"
                                : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted"
                        }`}
                    >
                        Overview
                    </button>
                    {dashboards.map(d => (
                        <div key={d.id} className="relative flex items-center group">
                            <button
                                onClick={() => setActiveTab(d.id)}
                                className={`px-4 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                                    activeTab === d.id
                                        ? "border-primary text-primary"
                                        : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted"
                                }`}
                            >
                                {d.name}
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); router.push(`/projects/${projectId}/dashboards/${d.id}/edit`); }}
                                className="p-1 rounded text-muted-foreground/0 group-hover:text-muted-foreground hover:text-primary! hover:bg-muted/50 transition-all -ml-1"
                                title={`Edit ${d.name}`}
                            >
                                <Pencil className="h-3 w-3" />
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); setDeleteTarget({ id: d.id, name: d.name }); }}
                                className="p-1 rounded text-muted-foreground/0 group-hover:text-muted-foreground hover:text-danger! hover:bg-danger/10 transition-all -ml-0.5"
                                title={`Delete ${d.name}`}
                            >
                                <Trash2 className="h-3 w-3" />
                            </button>
                        </div>
                    ))}
                </div>

                {/* Content Area */}
                {activeTab === "overview" ? (
                    <div className="space-y-4">
                        {/* System Overview heading */}
                        <h2 className="text-lg font-semibold text-foreground">System Overview</h2>

                        {/* Live stats: fleet size from core (structure/health),
                            throughput from analytics (measurement reader) */}
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
                            <Card variant="elevated">
                                <CardContent className="py-4">
                                    <div className="flex items-center gap-3">
                                        <Radio className="h-5 w-5 text-primary shrink-0" />
                                        <div>
                                            <p className="text-2xl font-semibold text-foreground">{totalOnline}<span className="text-sm text-muted-foreground font-normal"> / {totalDevices}</span></p>
                                            <p className="text-xs text-muted-foreground">devices online</p>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                            <Card variant="elevated">
                                <CardContent className="py-4">
                                    <div className="flex items-center gap-3">
                                        <Activity className="h-5 w-5 text-primary shrink-0" />
                                        <div>
                                            <p className="text-2xl font-semibold text-foreground">{ingestRate ? ingestRate.ratePerMinute.toLocaleString() : "–"}</p>
                                            <p className="text-xs text-muted-foreground">measurements / min</p>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                            <Card variant="elevated">
                                <CardContent className="py-4">
                                    <div className="flex items-center gap-3">
                                        <Wifi className="h-5 w-5 text-primary shrink-0" />
                                        <div>
                                            <p className="text-2xl font-semibold text-foreground">{ingestRate ? ingestRate.activeDevices : "–"}</p>
                                            <p className="text-xs text-muted-foreground">actively sending (15 min)</p>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                            <Card variant="elevated">
                                <CardContent className="py-4">
                                    <div className="flex items-center gap-3">
                                        <AlertTriangle className={`h-5 w-5 shrink-0 ${totalIssues > 0 ? "text-danger" : "text-muted-foreground/50"}`} />
                                        <div>
                                            <p className="text-2xl font-semibold text-foreground">{totalIssues}</p>
                                            <p className="text-xs text-muted-foreground">stale / offline devices</p>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>

                        {/* Synoptic Canvas */}
                        {graphObjects.length === 0 ? (
                            <Card variant="elevated" className="shrink-0">
                                <CardContent>
                                    <div className="py-12 text-center">
                                        <Building2 className="h-10 w-10 mx-auto mb-3 text-muted-foreground/40" />
                                        <p className="text-sm font-medium text-foreground mb-1">No objects in this project</p>
                                        <p className="text-xs text-muted-foreground mb-4">Add buildings and sensors to see the live topology.</p>
                                        <Button variant="primary" size="sm" onClick={() => router.push(`/projects/${projectId}/ide`)}>
                                            <Plus className="h-4 w-4 mr-1.5" /> Configure Project
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        ) : (
                            <div className="h-125 lg:h-150">
                                <SynopticView
                                    projectId={projectId}
                                    objects={graphObjects}
                                    links={graphLinks}
                                />
                            </div>
                        )}

                        {/* KPI + Events row */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 shrink-0">
                            {/* KPI Overview */}
                            {kpisLoading ? (
                                <Card variant="elevated">
                                    <CardHeader><CardTitle>KPIs</CardTitle></CardHeader>
                                    <CardContent>
                                        <div className="flex justify-center py-4"><LoadingSpinner /></div>
                                    </CardContent>
                                </Card>
                            ) : projectKpis.length > 0 ? (
                                <Card variant="elevated">
                                    <CardHeader><CardTitle>KPIs</CardTitle></CardHeader>
                                    <CardContent>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                            {projectKpis.map(kpi => (
                                                <div key={kpi.formula.id} className="p-3 rounded-lg border border-border/50 bg-muted/30">
                                                    <p className="text-xs text-muted-foreground truncate">{kpi.formula.displayName}</p>
                                                    <div className="flex items-baseline gap-1.5 mt-0.5">
                                                        <span className="text-lg font-bold text-foreground">
                                                            {kpi.result !== null ? kpi.result.toFixed(1) : "—"}
                                                        </span>
                                                        {kpi.formula.unit && (
                                                            <span className="text-xs text-muted-foreground">{kpi.formula.unit}</span>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-1.5 mt-1">
                                                        <KpiQualityBadge quality={kpi.quality} />
                                                        <span className="text-[10px] text-muted-foreground truncate">{kpi.objectName}</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </CardContent>
                                </Card>
                            ) : null}

                            {/* Recent Events */}
                            <Card variant="elevated">
                                <CardHeader>
                                    <div className="flex items-center justify-between">
                                        <CardTitle>Recent Events</CardTitle>
                                        {graphObjects.length > 0 && (
                                            <button
                                                type="button"
                                                onClick={() => setShowLogEvent(true)}
                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-primary bg-primary/10 hover:bg-primary/20 transition-colors"
                                            >
                                                <Plus className="h-3.5 w-3.5" />
                                                Log Event
                                            </button>
                                        )}
                                    </div>
                                </CardHeader>
                                <CardContent>
                                    <RecentEventsList
                                        events={recentEvents}
                                        objects={graphObjects}
                                        onLogEvent={() => setShowLogEvent(true)}
                                        onViewAll={() => router.push(`/projects/${projectId}/analysis`)}
                                    />
                                </CardContent>
                            </Card>
                        </div>

                        {/* Log Event Modal */}
                        {graphObjects.length > 0 && (
                            <LogEventModal
                                open={showLogEvent}
                                onClose={() => setShowLogEvent(false)}
                                objects={graphObjects}
                                onEventLogged={() => mutateEvents()}
                            />
                        )}
                    </div>
                ) : activeDashboard ? (
                    <DashboardRenderer
                        dashboard={activeDashboard}
                        timeRange={timeRange}
                        live={live}
                        onUseTemplate={() => {
                            setTemplatePickerDashboardId(activeDashboard.id);
                            setTemplatePickerOpen(true);
                        }}
                    />
                ) : null}
            </div>

            {/* Template Picker */}
            <TemplatePickerModal
                open={templatePickerOpen}
                onClose={() => { setTemplatePickerOpen(false); setTemplatePickerDashboardId(null); }}
                onApply={handleApplyTemplate}
                applying={applyingTemplate}
            />

            {/* Delete Dashboard Confirmation */}
            <ConfirmModal
                open={!!deleteTarget}
                onClose={() => { setDeleteTarget(null); setDeleteError(null); }}
                onConfirm={handleDeleteDashboard}
                title="Delete Dashboard"
                message={`Are you sure you want to delete "${deleteTarget?.name}"?`}
                detail="All widgets and their configuration will be permanently removed. This action cannot be undone."
                confirmLabel="Delete Dashboard"
                loading={deleting}
                error={deleteError}
            />
        </div>
    );
}

