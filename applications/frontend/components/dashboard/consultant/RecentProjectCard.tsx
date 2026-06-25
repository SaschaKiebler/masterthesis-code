"use client";

import { Card } from "@/components/ui/Card";
import {
    FolderOpen,
    Building2,
    Calendar,
    Monitor,
    Wrench,
    BarChart3,
    Plus,
} from "lucide-react";
import type { ProjectDTO } from "@/lib/api/types";
import { getStatusBadge } from "@/components/dashboard/consultant/helpers";

export function RecentProjectCard({
    project,
    onNavigate,
}: {
    project: ProjectDTO;
    onNavigate: (path: string) => void;
}) {
    const base = `/projects/${project.id}`;

    return (
        <Card variant="default" className="group flex flex-col">
            {/* Clickable header area */}
            <div
                className="flex-1 cursor-pointer"
                onClick={() => onNavigate(base)}
            >
                <div className="flex items-start justify-between mb-2">
                    <div className="p-2 rounded-lg bg-primary/10">
                        <FolderOpen className="h-4 w-4 text-primary" />
                    </div>
                    {getStatusBadge(project.status)}
                </div>
                <h3 className="text-sm font-semibold text-foreground mb-1 truncate">
                    {project.name}
                </h3>
                {project.description && (
                    <p className="text-xs text-muted-foreground line-clamp-1 mb-2">
                        {project.description}
                    </p>
                )}
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                        <Building2 className="h-3 w-3" />
                        {project.siteCount} site{project.siteCount !== 1 ? "s" : ""}
                    </span>
                    <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {new Date(project.updatedAt).toLocaleDateString()}
                    </span>
                </div>
            </div>

            {/* Quick-resume action buttons */}
            <div className="flex items-center flex-wrap gap-1 mt-3 pt-3 border-t border-border/50">
                <button
                    onClick={(e) => { e.stopPropagation(); onNavigate(base); }}
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    title="Monitor"
                >
                    <Monitor className="h-3 w-3 shrink-0" />
                    Monitor
                </button>
                <button
                    onClick={(e) => { e.stopPropagation(); onNavigate(`${base}/ide`); }}
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    title="Configure"
                >
                    <Wrench className="h-3 w-3 shrink-0" />
                    Configure
                </button>
                <button
                    onClick={(e) => { e.stopPropagation(); onNavigate(`${base}/ide?action=add-sensor`); }}
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs text-primary hover:text-primary/80 hover:bg-primary/10 transition-colors"
                    title="Add Sensor"
                >
                    <Plus className="h-3 w-3 shrink-0" />
                    Sensor
                </button>
            </div>
        </Card>
    );
}
