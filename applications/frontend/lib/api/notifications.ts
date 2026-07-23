/**
 * Notification service API — Meldungen and per-tenant notification rules.
 * Goes through the BFF proxy at /api/notifications/* which forwards to the
 * notification service with the session token as Bearer.
 */

const BASE = "/api/notifications";

export type NotificationSeverity = "INFO" | "WARNING" | "ERROR" | "CRITICAL";

export interface Meldung {
    id: string;
    tenantId: string;
    ruleId: string | null;
    type: string;
    severity: NotificationSeverity;
    deviceId: string;
    metricId: number;
    assetRef: string | null;
    summary: string;
    detail: string;
    detectedAt: string;
    createdAt: string;
    acknowledgedAt: string | null;
    acknowledgedBy: string | null;
}

export interface NotificationRule {
    id: string;
    tenantId: string;
    name: string;
    eventTypes: string[];
    minSeverity: NotificationSeverity;
    cooldownMinutes: number;
    webhookUrl: string | null;
    webhookToken: string | null;
    enabled: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface RuleInput {
    name: string;
    eventTypes?: string[];
    minSeverity?: NotificationSeverity;
    cooldownMinutes?: number;
    webhookUrl?: string | null;
    enabled?: boolean;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${BASE}${path}`, {
        headers: { "Content-Type": "application/json" },
        ...init,
    });
    if (!response.ok) {
        throw new Error(`Notification API error ${response.status}`);
    }
    if (response.status === 204) {
        return undefined as T;
    }
    return response.json() as Promise<T>;
}

export function listNotifications(params?: {
    severity?: string;
    acknowledged?: boolean;
    limit?: number;
}): Promise<Meldung[]> {
    const qs = new URLSearchParams();
    if (params?.severity) qs.set("severity", params.severity);
    if (params?.acknowledged !== undefined) qs.set("acknowledged", String(params.acknowledged));
    if (params?.limit) qs.set("limit", String(params.limit));
    const query = qs.toString();
    return request<Meldung[]>(`/notifications${query ? `?${query}` : ""}`);
}

export function acknowledgeNotification(id: string): Promise<Meldung> {
    return request<Meldung>(`/notifications/${id}/ack`, { method: "PATCH" });
}

export function listRules(): Promise<NotificationRule[]> {
    return request<NotificationRule[]>("/notification-rules");
}

export function createRule(input: RuleInput): Promise<NotificationRule> {
    return request<NotificationRule>("/notification-rules", {
        method: "POST",
        body: JSON.stringify(input),
    });
}

export function updateRule(id: string, input: Partial<RuleInput>): Promise<NotificationRule> {
    return request<NotificationRule>(`/notification-rules/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
    });
}

export function deleteRule(id: string): Promise<void> {
    return request<void>(`/notification-rules/${id}`, { method: "DELETE" });
}
