"use client";

import { useMemo } from "react";
import { LayoutDashboard, ExternalLink, Plus } from "lucide-react";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import type { GraphObject, Dashboard } from "@/lib/api/types";

// ─── Dashboards section ───────────────────────────────────────────────────────

export interface DashboardsSectionProps {
    projectId: string;
    object: GraphObject;
    dashboards: Dashboard[];
    loading: boolean;
    onEdit: (dashboardId: string) => void;
    onCreateNew: () => void;
}

export function DashboardsSection({
    projectId,
    object,
    dashboards,
    loading,
    onEdit,
    onCreateNew,
}: DashboardsSectionProps) {
    // Show dashboards scoped to this object OR project-wide (scopeType null)
    const relevant = useMemo(
        () => dashboards.filter((d) => !d.scopeId || d.scopeId === object.id),
        [dashboards, object.id]
    );

    return (
        <div className="px-4 py-3 border-b border-border/50">
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    <LayoutDashboard className="h-3 w-3 text-muted-foreground" />
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Dashboards</p>
                    <InfoTooltip text="Dashboards visualize live sensor data with charts and gauges. Create one, then drag sensors onto it to add widgets." />
                    <span className="text-[10px] text-muted-foreground/60 tabular-nums">{relevant.length}</span>
                </div>
                <button
                    onClick={onCreateNew}
                    className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    title="New dashboard"
                >
                    <Plus className="h-3.5 w-3.5" />
                </button>
            </div>

            {loading && (
                <p className="text-xs text-muted-foreground py-1">Loading...</p>
            )}

            {!loading && relevant.length === 0 && (
                <p className="text-xs text-muted-foreground py-1">No dashboards yet.</p>
            )}

            {relevant.map((d) => (
                <button
                    key={d.id}
                    onClick={() => onEdit(d.id)}
                    className="flex items-center gap-2 w-full py-1.5 text-left group hover:bg-muted/30 rounded px-1 -mx-1 transition-colors"
                >
                    <LayoutDashboard className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span className="text-xs text-foreground truncate flex-1">{d.name}</span>
                    <span className="text-[10px] text-muted-foreground/60 shrink-0">
                        {d.scopeType ? d.scopeType.toLowerCase() : "project"}
                    </span>
                    <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                </button>
            ))}

            <button
                onClick={onCreateNew}
                className="flex items-center gap-1.5 mt-1.5 text-xs text-primary hover:text-primary/80 transition-colors"
            >
                <Plus className="h-3 w-3" />
                New Dashboard
            </button>
        </div>
    );
}
