/**
 * Project API functions — ADR-012 / ADR-013
 * CRUD operations for projects, project-site management,
 * and project-scoped analytics endpoints.
 */

import { apiFetch, buildQueryString } from "./client";
import type {
    ProjectsResponse,
    ProjectDetailResponse,
    ProjectGraphResponse,
    ProjectDTO,
    CreateProjectRequest,
    Measurement,
    TimeRange,
} from "./types";

/**
 * List all projects accessible to the current user.
 */
export async function listProjects(): Promise<ProjectsResponse> {
    return apiFetch<ProjectsResponse>("/projects");
}

/**
 * Get a project with its sites.
 */
export async function getProject(projectId: string): Promise<ProjectDetailResponse> {
    return apiFetch<ProjectDetailResponse>(`/projects/${projectId}`);
}

/**
 * Create a new project.
 */
export async function createProject(data: CreateProjectRequest): Promise<{ project: ProjectDTO }> {
    return apiFetch<{ project: ProjectDTO }>("/projects", {
        method: "POST",
        body: JSON.stringify(data),
    });
}

/**
 * Update a project.
 */
export async function updateProject(
    projectId: string,
    data: { name?: string; description?: string; status?: string }
): Promise<{ project: ProjectDTO }> {
    return apiFetch<{ project: ProjectDTO }>(`/projects/${projectId}`, {
        method: "PATCH",
        body: JSON.stringify(data),
    });
}

/**
 * Delete a project.
 */
export async function deleteProject(projectId: string): Promise<void> {
    await apiFetch(`/projects/${projectId}`, { method: "DELETE" });
}

/**
 * Add a site to a project.
 */
export async function addSiteToProject(projectId: string, siteId: string): Promise<void> {
    await apiFetch(`/projects/${projectId}/sites`, {
        method: "POST",
        body: JSON.stringify({ siteId }),
    });
}

/**
 * Remove a site from a project.
 */
export async function removeSiteFromProject(projectId: string, siteId: string): Promise<void> {
    await apiFetch(`/projects/${projectId}/sites/${siteId}`, { method: "DELETE" });
}

/**
 * Get the full graph for a project (all objects + links across all sites).
 */
export async function getProjectGraph(projectId: string): Promise<ProjectGraphResponse> {
    return apiFetch<ProjectGraphResponse>(`/projects/${projectId}/graph`);
}

// ─── Project Settings ──────────────────────────────────────────────────────

export interface ProjectSettings {
    synopticPositions?: Record<string, { x: number; y: number }>;
    synopticLightMode?: boolean;
    [key: string]: unknown;
}

/**
 * Get project settings (synoptic positions, etc.).
 */
export async function getProjectSettings(projectId: string): Promise<ProjectSettings> {
    return apiFetch<ProjectSettings>(`/projects/${projectId}/settings`);
}

/**
 * Save project settings (full replace).
 */
export async function updateProjectSettings(
    projectId: string,
    settings: ProjectSettings
): Promise<ProjectSettings> {
    return apiFetch<ProjectSettings>(`/projects/${projectId}/settings`, {
        method: "PUT",
        body: JSON.stringify(settings),
    });
}

// ─── ADR-013 C.5: Project-Scoped Analytics ────────────────────────────────

export interface ProjectMetricPoint {
    id: string;
    deviceId: string;
    metricId: number;
    displayName?: string;
    unit: string;
    source?: string;
    field?: string;
    minValue?: number;
    maxValue?: number;
    quantityId?: string;
    quantityName?: string;
    quantityDisplayName?: string;
    dimension?: string;
    defaultUnit?: string;
    assetId: string;
    assetName: string;
    assetTypeName: string;
    sampleIntervalSeconds?: number;
}

export interface ProjectMetricPointsResponse {
    metricPoints: ProjectMetricPoint[];
}

export interface ProjectMeasurementsResponse {
    measurements: Measurement[];
    count: number;
    bucketMinutes: number;
}

export interface ProjectEvent {
    id: string;
    time: number;
    objectId: string;
    eventType: string;
    severity: string;
    summary: string;
    details: Record<string, unknown>;
    source: string;
    sourceId?: string;
    resolvedAt?: number;
    resolvedBy?: string;
    resolutionNote?: string;
}

export interface ProjectEventsResponse {
    events: ProjectEvent[];
    count: number;
}

/**
 * Get all metric points in a project's scope (enriched with asset + quantity context).
 * Single call replaces N parallel per-device fetches.
 */
export async function getProjectMetricPoints(
    projectId: string
): Promise<ProjectMetricPointsResponse> {
    return apiFetch<ProjectMetricPointsResponse>(
        `/projects/${projectId}/metric-points`
    );
}

/**
 * Get aggregated measurements for metric points in a project.
 * If metricPointIds is omitted, fetches for ALL metric points in the project.
 */
export async function getProjectMeasurements(
    projectId: string,
    params: {
        metricPointIds?: string;
        from?: number;
        to?: number;
        bucket?: number;
    }
): Promise<ProjectMeasurementsResponse> {
    const qs = buildQueryString(params);
    return apiFetch<ProjectMeasurementsResponse>(
        `/projects/${projectId}/measurements${qs}`
    );
}

// ─── Cross-Building Comparison ───────────────────────────────────────────────

export interface ComparisonPoint {
    time: number;
    value: number | null;
}

export interface ComparisonSeries {
    siteId: string;
    siteName: string;
    measurements: ComparisonPoint[];
}

export interface ProjectComparisonResponse {
    series: ComparisonSeries[];
}

/**
 * Compare a single physical quantity across all buildings in a project.
 * Backend averages all sensors of that quantity per building per time bucket.
 */
export async function getProjectComparison(
    projectId: string,
    params: {
        quantityName: string;
        from: number;
        to: number;
        bucket?: number;
    }
): Promise<ProjectComparisonResponse> {
    const qs = buildQueryString(params);
    return apiFetch<ProjectComparisonResponse>(
        `/projects/${projectId}/compare${qs}`
    );
}

// ─── Derived Properties ───────────────────────────────────────────────────────

export interface ProjectDerivedProperty {
    id: string;
    objectId: string;
    objectName: string;
    objectTypeName: string;
    propertyName: string;
    displayName: string;
    valueNumeric: number | null;
    valueText: string | null;
    unit: string | null;
    confidence: number | null;   // 0.0–1.0
    quality: string | null;      // GOOD | STALE | LOW_CONFIDENCE | INSUFFICIENT_DATA
    sourceType: string;          // RULE | PIPELINE | MODEL | AGGREGATION
    computedAt: number;          // epoch seconds
}

export interface ProjectDerivedPropertiesResponse {
    derivedProperties: ProjectDerivedProperty[];
}

/**
 * Get current derived properties for all objects in a project scope.
 * Optional objectTypes filter (comma-separated type names).
 */
export async function getProjectDerivedProperties(
    projectId: string,
    params?: { objectTypes?: string }
): Promise<ProjectDerivedPropertiesResponse> {
    const qs = params ? buildQueryString(params) : "";
    return apiFetch<ProjectDerivedPropertiesResponse>(
        `/projects/${projectId}/derived-properties${qs}`
    );
}

// ─── Project Health ──────────────────────────────────────────────────────────

export interface DeviceHealth {
    objectId: string;
    deviceId: string;
    displayName: string;
    objectTypeName: string;
    objectTypeCategory: string;
    status: "online" | "stale" | "offline" | "no_data";
    lastSeenEpoch: number | null;
}

export interface BuildingSummary {
    online: number;
    stale: number;
    offline: number;
    noData: number;
}

export interface BuildingHealth {
    id: string;
    name: string;
    status: "healthy" | "warning" | "critical" | "offline";
    devices: DeviceHealth[];
    summary: BuildingSummary;
}

export interface ProjectHealthTotals {
    buildings: number;
    devices: number;
    online: number;
    stale: number;
    offline: number;
}

export interface ProjectHealthResponse {
    buildings: BuildingHealth[];
    totals: ProjectHealthTotals;
}

// ─── Latest Values (Synoptic View) ──────────────────────────────────────────

export interface LatestValue {
    metricPointId: string;
    deviceId: string;
    metricId: number;
    displayName: string;
    unit: string;
    quantityName: string;
    assetObjectId: string;
    value: number | null;
    time: number | null; // epoch seconds
}

export interface ProjectLatestValuesResponse {
    values: LatestValue[];
}

/**
 * Get latest measurement per metric point for all devices in a project.
 */
export async function getProjectLatestValues(
    projectId: string
): Promise<ProjectLatestValuesResponse> {
    return apiFetch<ProjectLatestValuesResponse>(`/projects/${projectId}/latest-values`);
}

/**
 * Get device-level health for all buildings in a project.
 */
export async function getProjectHealth(
    projectId: string
): Promise<ProjectHealthResponse> {
    return apiFetch<ProjectHealthResponse>(`/projects/${projectId}/health`);
}

/**
 * Get events in a project's scope.
 */
export async function getProjectEvents(
    projectId: string,
    params?: {
        from?: number;
        to?: number;
        severity?: string;
        objectIds?: string;
        limit?: number;
        offset?: number;
    }
): Promise<ProjectEventsResponse> {
    const qs = params ? buildQueryString(params) : "";
    return apiFetch<ProjectEventsResponse>(
        `/projects/${projectId}/events${qs}`
    );
}
