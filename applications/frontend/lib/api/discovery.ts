/**
 * MQTT Device Discovery API
 * Start/poll/stop discovery sessions and analyze captured payloads.
 */

import { apiFetch, buildQueryString } from "./client";
import type { DiscoverySession, PayloadAnalysis, StartDiscoveryRequest } from "./types";

export async function startDiscovery(request: StartDiscoveryRequest): Promise<DiscoverySession> {
    return apiFetch<DiscoverySession>("/device-discovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
    });
}

export async function getDiscoverySession(sessionId: string, since?: number): Promise<DiscoverySession> {
    const qs = since ? buildQueryString({ since }) : "";
    return apiFetch<DiscoverySession>(`/device-discovery/${sessionId}${qs}`);
}

export async function stopDiscovery(sessionId: string): Promise<DiscoverySession> {
    return apiFetch<DiscoverySession>(`/device-discovery/${sessionId}`, {
        method: "DELETE",
    });
}

export async function analyzeDiscovery(sessionId: string): Promise<PayloadAnalysis> {
    return apiFetch<PayloadAnalysis>(`/device-discovery/${sessionId}/analyze`, {
        method: "POST",
    });
}
