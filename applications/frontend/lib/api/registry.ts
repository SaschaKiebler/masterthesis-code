/**
 * Ontology Registry API Functions (ADR-007)
 * CRUD for object types and device templates
 */

import { apiFetch } from "./client";
import type {
    ObjectTypesResponse,
    DeviceTemplatesResponse,
    ObjectTypeResponse,
    DeviceTemplateResponse,
    CreateObjectTypeRequest,
    UpdateObjectTypeRequest,
    CreateDeviceTemplateRequest,
    UpdateDeviceTemplateRequest,
    DeleteResponse,
    GenerateTemplateResponse,
} from "./types";

// ── Object Types ────────────────────────────────────────────────────────────

/**
 * List all active object types
 */
export async function listObjectTypes(): Promise<ObjectTypesResponse> {
    return apiFetch<ObjectTypesResponse>("/object-types");
}

/**
 * Create a new object type (system_admin only)
 */
export async function createObjectType(body: CreateObjectTypeRequest): Promise<ObjectTypeResponse> {
    return apiFetch<ObjectTypeResponse>("/object-types", {
        method: "POST",
        body: JSON.stringify(body),
    });
}

/**
 * Update an existing object type (system_admin only)
 */
export async function updateObjectType(id: string, body: UpdateObjectTypeRequest): Promise<ObjectTypeResponse> {
    return apiFetch<ObjectTypeResponse>(`/object-types/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
    });
}

/**
 * Soft-delete an object type (system_admin only)
 */
export async function deleteObjectType(id: string): Promise<DeleteResponse> {
    return apiFetch<DeleteResponse>(`/object-types/${id}`, {
        method: "DELETE",
    });
}

// ── Device Templates ────────────────────────────────────────────────────────

/**
 * List all active device templates
 */
export async function listDeviceTemplates(protocol?: string): Promise<DeviceTemplatesResponse> {
    const query = protocol ? `?protocol=${encodeURIComponent(protocol)}` : "";
    return apiFetch<DeviceTemplatesResponse>(`/device-templates${query}`);
}

/**
 * Create a new device template
 * System admin for system-wide, manager for tenant-scoped
 */
export async function createDeviceTemplate(body: CreateDeviceTemplateRequest): Promise<DeviceTemplateResponse> {
    return apiFetch<DeviceTemplateResponse>("/device-templates", {
        method: "POST",
        body: JSON.stringify(body),
    });
}

/**
 * Update an existing device template
 */
export async function updateDeviceTemplate(id: string, body: UpdateDeviceTemplateRequest): Promise<DeviceTemplateResponse> {
    return apiFetch<DeviceTemplateResponse>(`/device-templates/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
    });
}

/**
 * Soft-delete a device template
 */
export async function deleteDeviceTemplate(id: string): Promise<DeleteResponse> {
    return apiFetch<DeleteResponse>(`/device-templates/${id}`, {
        method: "DELETE",
    });
}

// ── AI Template Generation ─────────────────────────────────────────────────

/**
 * Generate a device template via the n8n AI workflow (dryRun mode).
 * Routes through core-platform — n8n credentials never reach the browser.
 */
export async function generateTemplate(sensorName: string): Promise<GenerateTemplateResponse> {
    return apiFetch<GenerateTemplateResponse>("/templates/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sensorName }),
    });
}
