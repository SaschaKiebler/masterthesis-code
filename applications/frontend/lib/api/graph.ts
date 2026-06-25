/**
 * Graph API functions — ADR-011 Phase C
 * Link management endpoints backed by the objects/links ontology graph.
 */

import { apiFetch } from "./client";
import type {
    GraphObject,
    SiteObjectsResponse,
    SiteGraphResponse,
    ObjectLinksResponse,
    ObjectTypesResponse,
    CreateLinkRequest,
    CreateLinkResponse,
    LinkTypesResponse,
    CreateLinkTypeRequest,
    CreateLinkTypeResponse,
    CreateObjectRequest,
    CreateObjectResponse,
    DeviceConfigResponse,
    UpdateDeviceConfigRequest,
} from "./types";

/**
 * Get all objects scoped to a site (building, spaces, assets).
 * Used to populate target-object dropdowns in the link management UI.
 */
export async function getSiteObjects(siteId: string): Promise<SiteObjectsResponse> {
    return apiFetch<SiteObjectsResponse>(`/sites/${siteId}/objects`);
}

/**
 * Get all inbound and outbound links for a given object.
 */
export async function getObjectLinks(objectId: string): Promise<ObjectLinksResponse> {
    return apiFetch<ObjectLinksResponse>(`/objects/${objectId}/links`);
}

/**
 * Create a new link between two objects.
 */
export async function createLink(data: CreateLinkRequest): Promise<CreateLinkResponse> {
    return apiFetch<CreateLinkResponse>("/links", {
        method: "POST",
        body: JSON.stringify(data),
    });
}

/**
 * Update an object's display name.
 */
export async function updateObject(objectId: string, displayName: string): Promise<{ object: GraphObject }> {
    return apiFetch<{ object: GraphObject }>(`/objects/${objectId}`, {
        method: "PATCH",
        body: JSON.stringify({ displayName }),
    });
}

/**
 * Get the full site graph — all objects + all links in one request.
 * Used by the visual graph editor canvas.
 */
export async function getSiteGraph(siteId: string): Promise<SiteGraphResponse> {
    return apiFetch<SiteGraphResponse>(`/sites/${siteId}/graph`);
}

/**
 * Fetch all active object types from the database.
 * Used by the IDE type picker when creating new objects.
 */
export async function getObjectTypes(): Promise<ObjectTypesResponse> {
    return apiFetch<ObjectTypesResponse>("/object-types");
}

/**
 * Generate a P&ID-style SVG icon for an object type via AI.
 * Calls n8n webhook, uploads to GCS, saves URL on the ObjectType.
 */
export async function generateObjectTypeSvg(
    objectTypeId: string
): Promise<{ svgIconUrl: string; objectTypeName: string }> {
    return apiFetch<{ svgIconUrl: string; objectTypeName: string }>(
        `/object-types/${objectTypeId}/generate-svg`,
        { method: "POST" }
    );
}

/**
 * Create a new standalone object.
 */
export async function createObject(data: CreateObjectRequest): Promise<CreateObjectResponse> {
    return apiFetch<CreateObjectResponse>("/objects", {
        method: "POST",
        body: JSON.stringify(data),
    });
}

/**
 * Delete an object and all its links.
 */
export async function deleteObject(objectId: string): Promise<void> {
    await apiFetch(`/objects/${objectId}`, { method: "DELETE" });
}

/**
 * Delete a link by ID.
 */
export async function deleteLink(linkId: string): Promise<void> {
    await apiFetch(`/links/${linkId}`, { method: "DELETE" });
}

/**
 * Fetch all link types from the database.
 */
export async function getLinkTypes(): Promise<LinkTypesResponse> {
    return apiFetch<LinkTypesResponse>("/link-types");
}

/**
 * Create a new link type on the fly.
 */
export async function createLinkType(data: CreateLinkTypeRequest): Promise<CreateLinkTypeResponse> {
    return apiFetch<CreateLinkTypeResponse>("/link-types", {
        method: "POST",
        body: JSON.stringify(data),
    });
}

/**
 * Get the device config (assets extension) for a graph object.
 * Returns null if the object has no device extension.
 */
export async function getDeviceConfig(objectId: string): Promise<DeviceConfigResponse | null> {
    try {
        return await apiFetch<DeviceConfigResponse>(`/objects/${objectId}/device`);
    } catch {
        return null;
    }
}

/**
 * Create or update the device config for a graph object.
 * If no assets row exists, creates one. If it exists, updates it.
 */
export async function updateDeviceConfig(objectId: string, data: UpdateDeviceConfigRequest): Promise<DeviceConfigResponse> {
    return apiFetch<DeviceConfigResponse>(`/objects/${objectId}/device`, {
        method: "PATCH",
        body: JSON.stringify(data),
    });
}

export interface DeviceMetricPoint {
    id: string;
    metricId: number;
    displayName?: string;
    unit?: string;
    quantityName?: string;
    dimension?: string;
}

/** Fetch metric points linked to a device object (keyed by signal-map index). */
export async function getDeviceMetricPoints(objectId: string): Promise<DeviceMetricPoint[]> {
    try {
        const res = await apiFetch<{ metricPoints: DeviceMetricPoint[] }>(`/objects/${objectId}/metrics`);
        return res.metricPoints ?? [];
    } catch {
        return [];
    }
}

/** Update custom properties for a graph object (ADR-014). */
export async function updateObjectProperties(
    objectId: string,
    values: Record<string, unknown>
): Promise<{ object: GraphObject }> {
    return apiFetch<{ object: GraphObject }>(`/objects/${objectId}/properties`, {
        method: "PATCH",
        body: JSON.stringify(values),
    });
}
