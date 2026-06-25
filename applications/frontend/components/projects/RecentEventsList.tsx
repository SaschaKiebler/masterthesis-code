import { useMemo } from "react";
import { AlertTriangle, AlertCircle, Info, Bug, XCircle, ClipboardList, Plus } from "lucide-react";
import type { ProjectEvent } from "@/lib/api/projects";

const SEVERITY_ICON: Record<string, typeof AlertCircle> = {
    CRITICAL: XCircle,
    ERROR: AlertCircle,
    WARNING: AlertTriangle,
    INFO: Info,
    DEBUG: Bug,
};

const SEVERITY_STYLE: Record<string, { color: string; bg: string; border: string }> = {
    CRITICAL: { color: "text-red-600", bg: "bg-red-50 dark:bg-red-950/30", border: "border-l-red-600" },
    ERROR:    { color: "text-red-500", bg: "bg-red-50 dark:bg-red-950/20", border: "border-l-red-500" },
    WARNING:  { color: "text-amber-600", bg: "bg-amber-50 dark:bg-amber-950/20", border: "border-l-amber-500" },
    INFO:     { color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-950/20", border: "border-l-blue-500" },
    DEBUG:    { color: "text-gray-500", bg: "bg-gray-50 dark:bg-gray-900/30", border: "border-l-gray-400" },
};

function formatRelative(epochSeconds: number): string {
    const diff = Math.floor(Date.now() / 1000) - epochSeconds;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

interface RecentEventsListProps {
    events: ProjectEvent[];
    objects: { id: string; displayName: string }[];
    onLogEvent: () => void;
    onViewAll: () => void;
}

export function RecentEventsList({
    events,
    objects,
    onLogEvent,
    onViewAll,
}: RecentEventsListProps) {
    const nameMap = useMemo(() => {
        const m = new Map<string, string>();
        for (const o of objects) m.set(o.id, o.displayName);
        return m;
    }, [objects]);

    if (events.length === 0) {
        return (
            <div className="py-6 text-center">
                <ClipboardList className="h-8 w-8 mx-auto mb-3 text-muted-foreground/40" />
                <p className="text-sm font-medium text-foreground mb-1">No events yet</p>
                <p className="text-xs text-muted-foreground mb-3">
                    Log maintenance, faults, or other operational events.
                </p>
                {objects.length > 0 && (
                    <button
                        type="button"
                        onClick={onLogEvent}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-primary bg-primary/10 hover:bg-primary/20 transition-colors"
                    >
                        <Plus className="h-3.5 w-3.5" />
                        Log first event
                    </button>
                )}
            </div>
        );
    }

    return (
        <div className="space-y-1.5">
            {events.map((event) => {
                const style = SEVERITY_STYLE[event.severity] || SEVERITY_STYLE.INFO;
                const Icon = SEVERITY_ICON[event.severity] || Info;
                const objectName = nameMap.get(event.objectId);

                return (
                    <div
                        key={`${event.id}-${event.time}`}
                        className={`border-l-2 ${style.border} rounded-r-lg ${style.bg} px-3 py-2`}
                    >
                        <div className="flex items-start gap-2">
                            <Icon className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${style.color}`} />
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-foreground truncate">
                                    {event.summary}
                                </p>
                                <div className="flex items-center gap-2 mt-0.5">
                                    {objectName && (
                                        <span className="text-xs text-muted-foreground truncate">
                                            {objectName}
                                        </span>
                                    )}
                                    <span className="text-xs text-muted-foreground shrink-0">
                                        {formatRelative(event.time)}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })}

            {/* View all link */}
            <div className="pt-2 text-center">
                <button
                    type="button"
                    onClick={onViewAll}
                    className="text-xs text-primary hover:underline"
                >
                    View all events in Analysis
                </button>
            </div>
        </div>
    );
}
