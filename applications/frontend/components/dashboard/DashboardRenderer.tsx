"use client";

import Link from "next/link";
import { LayoutDashboard, Pencil, BookmarkPlus } from "lucide-react";
import type { Dashboard, DashboardWidget, TimeRange } from "@/lib/api/types";
import { TimeSeriesWidget } from "./widgets/TimeSeriesWidget";
import { GaugeWidget } from "./widgets/GaugeWidget";
import { StatusWidget } from "./widgets/StatusWidget";
import { StatCardWidget } from "./widgets/StatCardWidget";
// ADR-013 new widget types
import { DerivedPropertyWidget } from "./widgets/DerivedPropertyWidget";
import { EventTimelineWidget } from "./widgets/EventTimelineWidget";
import { ComparisonWidget } from "./widgets/ComparisonWidget";
import { EventLogWidget } from "./widgets/EventLogWidget";

interface DashboardRendererProps {
    dashboard: Dashboard;
    timeRange?: TimeRange;
    live: boolean;
    onUseTemplate?: () => void;
}

export function DashboardRenderer({ dashboard, timeRange, live, onUseTemplate }: DashboardRendererProps) {
    let layout;
    try {
        layout = JSON.parse(dashboard.layout);
    } catch (e) {
        return <div className="text-danger">Failed to parse dashboard layout JSON</div>;
    }

    if (!layout?.widgets || layout.widgets.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-20 border border-dashed border-border rounded-lg">
                <LayoutDashboard className="h-10 w-10 text-muted-foreground/40 mb-4" />
                <p className="text-sm font-medium text-foreground mb-1">This dashboard is empty</p>
                <p className="text-xs text-muted-foreground mb-4">Add charts, gauges, or status widgets to start monitoring.</p>
                <div className="flex items-center gap-2">
                    {onUseTemplate && (
                        <button
                            onClick={onUseTemplate}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-primary bg-primary/10 hover:bg-primary/20 transition-colors"
                        >
                            <BookmarkPlus className="h-3.5 w-3.5" />
                            Use a Template
                        </button>
                    )}
                    <Link
                        href={`/projects/${dashboard.projectId}/dashboards/${dashboard.id}/edit`}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground bg-muted/50 hover:bg-muted transition-colors"
                    >
                        <Pencil className="h-3.5 w-3.5" />
                        Edit from Scratch
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div 
            className="grid gap-4" 
            style={{ 
                gridTemplateColumns: `repeat(${layout.columns || 2}, minmax(0, 1fr))` 
            }}
        >
            {layout.widgets.map((widget: DashboardWidget) => {
                const props = {
                    widget,
                    timeRange,
                    live
                };

                const style = {
                    gridColumn: `span ${widget.position?.colSpan || 1} / span ${widget.position?.colSpan || 1}`,
                    gridRow: `span ${widget.position?.rowSpan || 1} / span ${widget.position?.rowSpan || 1}`
                };

                return (
                    <div key={widget.id} style={style}>
                        {widget.type === "time_series" && <TimeSeriesWidget {...props} />}
                        {widget.type === "gauge" && <GaugeWidget {...props} />}
                        {widget.type === "status" && <StatusWidget {...props} />}
                        {widget.type === "stat_card" && <StatCardWidget {...props} />}
                        {widget.type === "derived_property" && <DerivedPropertyWidget {...props} />}
                        {widget.type === "event_timeline" && <EventTimelineWidget {...props} />}
                        {widget.type === "comparison" && <ComparisonWidget {...props} />}
                        {widget.type === "event_log" && <EventLogWidget {...props} />}
                    </div>
                );
            })}
        </div>
    );
}
