/**
 * Metric Points API (ADR-013)
 * Replaces signal_map JSONB with first-class ontology objects.
 */

import { apiFetch } from "./client";

export interface MetricPoint {
    id: string;
    deviceId: string;
    metricId: number;
    displayName?: string;     // Original signal map entry name, e.g. "phase_a_active_power"
    source?: string;
    field?: string;
    quantityId?: string;
    quantityName?: string;
    quantityDisplayName?: string;
    dimension?: string;
    unit: string;
    defaultUnit?: string;
    minValue?: number;
    maxValue?: number;
    precisionDigits?: number;
    sampleIntervalSeconds?: number;
}

export interface MetricPointsResponse {
    metricPoints: MetricPoint[];
}

export interface CreateMetricPointRequest {
    deviceId: string;
    metricId: number;
    quantityName?: string;
    unit: string;
    source?: string;
    field?: string;
    minValue?: number;
    maxValue?: number;
    sampleIntervalSeconds?: number;
    tenantId?: string;
}

export interface UpdateMetricPointRequest {
    unit?: string;
    minValue?: number;
    maxValue?: number;
    sampleIntervalSeconds?: number;
    quantityName?: string;
}

export async function getMetricPoints(objectId: string): Promise<MetricPoint[]> {
    const res = await apiFetch<MetricPointsResponse>(`/objects/${objectId}/metrics`);
    return res.metricPoints;
}

export async function getMetricPoint(id: string): Promise<MetricPoint> {
    const res = await apiFetch<{ metricPoint: MetricPoint }>(`/metric-points/${id}`);
    return res.metricPoint;
}

export async function createMetricPoint(
    objectId: string,
    data: CreateMetricPointRequest
): Promise<MetricPoint> {
    const res = await apiFetch<{ metricPoint: MetricPoint }>(`/objects/${objectId}/metrics`, {
        method: "POST",
        body: JSON.stringify(data),
    });
    return res.metricPoint;
}

export async function updateMetricPoint(
    id: string,
    data: UpdateMetricPointRequest
): Promise<MetricPoint> {
    const res = await apiFetch<{ metricPoint: MetricPoint }>(`/metric-points/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
    });
    return res.metricPoint;
}

export async function deleteMetricPoint(id: string): Promise<void> {
    await apiFetch<void>(`/metric-points/${id}`, { method: "DELETE" });
}
