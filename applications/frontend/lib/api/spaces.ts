/**
 * Space API functions
 * CRUD operations for building spatial hierarchy
 */

import { apiFetch } from "./client";
import type { SpacesResponse, SpaceDTO, CreateSpaceRequest, UpdateSpaceRequest } from "./types";

/**
 * List spaces for a site (tree view by default)
 */
export async function listSpaces(siteId: string, view: "tree" | "flat" = "tree"): Promise<SpacesResponse> {
    return apiFetch<SpacesResponse>(`/sites/${siteId}/spaces?view=${view}`);
}

/**
 * Create a new space within a site
 */
export async function createSpace(siteId: string, data: CreateSpaceRequest): Promise<{ space: SpaceDTO }> {
    return apiFetch<{ space: SpaceDTO }>(`/sites/${siteId}/spaces`, {
        method: "POST",
        body: JSON.stringify(data),
    });
}

/**
 * Update an existing space
 */
export async function updateSpace(siteId: string, spaceId: string, data: UpdateSpaceRequest): Promise<{ space: SpaceDTO }> {
    return apiFetch<{ space: SpaceDTO }>(`/sites/${siteId}/spaces/${spaceId}`, {
        method: "PATCH",
        body: JSON.stringify(data),
    });
}

/**
 * Delete a space (children are re-parented)
 */
export async function deleteSpace(siteId: string, spaceId: string): Promise<void> {
    await apiFetch(`/sites/${siteId}/spaces/${spaceId}`, {
        method: "DELETE",
    });
}

/**
 * Update the signal map for an asset
 */
export async function updateAssetSignalMap(assetId: string, signalMap: string): Promise<any> {
    return apiFetch(`/assets/${assetId}/signal-map`, {
        method: "PATCH",
        body: JSON.stringify({ signalMap }),
    });
}

