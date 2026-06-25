"use client";

/**
 * EventTimelineWidget (ADR-013)
 * Scrollable timeline of operational events for objects in scope.
 */

import { useState, useEffect } from "react";
import type { DashboardWidget, TimeRange, GraphObject } from "@/lib/api/types";
import {
    queryEvents,
    resolveEvent,
    type OntologyEvent,
    SEVERITY_BORDER,
    SEVERITY_COLORS,
} from "@/lib/api/events";
import { LogEventModal } from "@/components/events/LogEventModal";
import { AlertCircle, CheckCircle2, RefreshCw, Clock, Plus } from "lucide-react";

interface Props {
    widget: DashboardWidget;
    timeRange?: TimeRange;
    live: boolean;
    objects?: GraphObject[];
}

export function EventTimelineWidget({ widget, timeRange, objects }: Props) {
    const { config } = widget;
    const [events, setEvents] = useState<OntologyEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showLogEvent, setShowLogEvent] = useState(false);

    const maxItems = config.maxItems ?? 10;
    const severities = config.severityFilter?.join(",");
    const eventTypes = config.eventTypeFilter?.join(",");

    const from = timeRange ? new Date(timeRange.from * 1000).toISOString() : undefined;
    const to = timeRange ? new Date(timeRange.to * 1000).toISOString() : undefined;

    const [fetchKey, setFetchKey] = useState(0);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);

        queryEvents({
            from,
            to,
            severities,
            eventTypes,
            limit: maxItems,
        })
            .then((res) => {
                if (!cancelled) setEvents(res.events);
            })
            .catch((e) => {
                if (!cancelled) setError(e.message ?? "Failed to load events");
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => { cancelled = true; };
    }, [from, to, severities, eventTypes, maxItems, fetchKey]);

    async function handleResolve(event: OntologyEvent) {
        await resolveEvent(event.id, event.time);
        setEvents((prev) => prev.filter((e) => e.id !== event.id));
    }

    if (loading) {
        return (
            <div className="rounded-lg border border-border bg-card p-4 h-full flex items-center justify-center">
                <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="rounded-lg border border-destructive/30 bg-card p-4 h-full flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-destructive shrink-0" />
                <p className="text-sm text-destructive">{error}</p>
            </div>
        );
    }

    return (
        <div className="rounded-lg border border-border bg-card p-4 h-full flex flex-col gap-2">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-foreground">{widget.title || "Events"}</h3>
                <div className="flex items-center gap-2">
                    {objects && objects.length > 0 && (
                        <button
                            type="button"
                            onClick={() => setShowLogEvent(true)}
                            className="p-1 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                            title="Log event"
                        >
                            <Plus className="h-3.5 w-3.5" />
                        </button>
                    )}
                    <span className="text-xs text-muted-foreground">{events.length} event{events.length !== 1 ? "s" : ""}</span>
                </div>
            </div>

            {events.length === 0 ? (
                <div className="flex-1 flex items-center justify-center">
                    <p className="text-sm text-muted-foreground">No events in this period</p>
                </div>
            ) : (
                <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                    {events.map((event) => (
                        <div
                            key={event.id}
                            className={`border-l-4 pl-3 pr-2 py-2 rounded-r bg-muted/30 ${SEVERITY_BORDER[event.severity]}`}
                        >
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <p className="text-xs font-medium text-foreground truncate">
                                        {event.summary}
                                    </p>
                                    {event.objectName && (
                                        <p className="text-xs text-muted-foreground truncate">
                                            {event.objectName}
                                        </p>
                                    )}
                                </div>
                                {!event.resolvedAt && (
                                    <button
                                        onClick={() => handleResolve(event)}
                                        title="Mark resolved"
                                        className="shrink-0 text-muted-foreground hover:text-emerald-600 transition-colors"
                                    >
                                        <CheckCircle2 className="w-3.5 h-3.5" />
                                    </button>
                                )}
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                                <span className={`text-xs px-1 rounded ${SEVERITY_COLORS[event.severity]}`}>
                                    {event.severity}
                                </span>
                                <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                                    <Clock className="w-2.5 h-2.5" />
                                    {formatTimestamp(event.time)}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Log Event Modal */}
            {objects && objects.length > 0 && (
                <LogEventModal
                    open={showLogEvent}
                    onClose={() => setShowLogEvent(false)}
                    objects={objects}
                    onEventLogged={() => setFetchKey((k) => k + 1)}
                />
            )}
        </div>
    );
}

function formatTimestamp(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
        month: "short", day: "numeric",
        hour: "2-digit", minute: "2-digit",
    });
}
