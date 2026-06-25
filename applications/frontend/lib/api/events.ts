/**
 * Events API (ADR-013)
 * Discrete operational occurrences on ontology objects.
 */

import { apiFetch, buildQueryString } from "./client";

export type EventSeverity = "DEBUG" | "INFO" | "WARNING" | "ERROR" | "CRITICAL";
export type EventSource = "SYSTEM" | "DEVICE" | "USER" | "MODEL";

export interface OntologyEvent {
    id: string;
    time: string; // ISO timestamp
    objectId: string;
    objectName?: string;
    eventType: string;
    severity: EventSeverity;
    summary: string;
    details: Record<string, unknown>;
    source: EventSource;
    sourceId?: string;
    resolvedAt?: string;
    resolvedBy?: string;
    resolutionNote?: string;
    tenantId: string;
}

export interface EventsResponse {
    events: OntologyEvent[];
    count: number;
}

export interface RecordEventRequest {
    eventType?: string;
    severity?: EventSeverity;
    summary: string;
    details?: Record<string, unknown>;
    time?: string;
}

export interface EventQuery {
    from?: string;
    to?: string;
    eventTypes?: string;
    severities?: string;
    limit?: number;
    offset?: number;
}

export const SEVERITY_COLORS: Record<EventSeverity, string> = {
    CRITICAL: "text-red-600 bg-red-50 border-red-200",
    ERROR:    "text-red-500 bg-red-50 border-red-100",
    WARNING:  "text-amber-600 bg-amber-50 border-amber-200",
    INFO:     "text-blue-600 bg-blue-50 border-blue-200",
    DEBUG:    "text-gray-500 bg-gray-50 border-gray-200",
};

export const SEVERITY_BORDER: Record<EventSeverity, string> = {
    CRITICAL: "border-l-red-600",
    ERROR:    "border-l-red-500",
    WARNING:  "border-l-amber-500",
    INFO:     "border-l-blue-500",
    DEBUG:    "border-l-gray-400",
};

export async function getObjectEvents(
    objectId: string,
    params?: { from?: string; to?: string; limit?: number; offset?: number }
): Promise<EventsResponse> {
    const qs = params ? buildQueryString(params as Record<string, unknown>) : "";
    return apiFetch<EventsResponse>(`/objects/${objectId}/events${qs}`);
}

export async function recordEvent(
    objectId: string,
    data: RecordEventRequest
): Promise<void> {
    await apiFetch<void>(`/objects/${objectId}/events`, {
        method: "POST",
        body: JSON.stringify(data),
    });
}

export async function queryEvents(query?: EventQuery): Promise<EventsResponse> {
    const qs = query ? buildQueryString(query as Record<string, unknown>) : "";
    return apiFetch<EventsResponse>(`/events${qs}`);
}

export async function resolveEvent(
    eventId: string,
    time: string,
    note?: string
): Promise<void> {
    await apiFetch<void>(`/events/${eventId}/resolve`, {
        method: "PATCH",
        body: JSON.stringify({ time, note: note ?? "" }),
    });
}

// ─── Event Templates ────────────────────────────────────────────────────────

export interface EventTemplate {
    id: string;
    tenantId: string | null;
    label: string;
    eventType: string;
    severity: EventSeverity;
    summary: string;
    sortOrder: number;
    createdAt: string;
    updatedAt: string;
}

export interface CreateEventTemplateRequest {
    label: string;
    eventType: string;
    severity?: string;
    summary: string;
    sortOrder?: number;
}

export interface UpdateEventTemplateRequest {
    label?: string;
    eventType?: string;
    severity?: string;
    summary?: string;
    sortOrder?: number;
}

export async function getEventTemplates(): Promise<EventTemplate[]> {
    return apiFetch<EventTemplate[]>("/event-templates");
}

export async function createEventTemplate(
    data: CreateEventTemplateRequest
): Promise<EventTemplate> {
    return apiFetch<EventTemplate>("/event-templates", {
        method: "POST",
        body: JSON.stringify(data),
    });
}

export async function updateEventTemplate(
    id: string,
    data: UpdateEventTemplateRequest
): Promise<EventTemplate> {
    return apiFetch<EventTemplate>(`/event-templates/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
    });
}

export async function deleteEventTemplate(id: string): Promise<void> {
    await apiFetch<void>(`/event-templates/${id}`, {
        method: "DELETE",
    });
}
