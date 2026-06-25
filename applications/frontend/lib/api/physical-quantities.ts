/**
 * Physical Quantities API (ADR-013)
 * Controlled vocabulary of measurable physical quantities.
 */

import { apiFetch, buildQueryString } from "./client";

export interface PhysicalQuantity {
    id: string;
    name: string;
    displayName: string;
    description?: string;
    dimension: string;
    defaultUnit: string;
    aggregation: string;
    domain: string;
}

export interface PhysicalQuantitiesResponse {
    quantities: PhysicalQuantity[];
}

export interface CreatePhysicalQuantityRequest {
    name: string;
    displayName: string;
    description?: string;
    dimension: string;
    defaultUnit: string;
    aggregation?: string;
    domain?: string;
    tenantId?: string;
}

export async function getPhysicalQuantities(filters?: {
    dimension?: string;
    domain?: string;
}): Promise<PhysicalQuantity[]> {
    const qs = filters ? buildQueryString(filters as Record<string, unknown>) : "";
    const res = await apiFetch<PhysicalQuantitiesResponse>(`/physical-quantities${qs}`);
    return res.quantities;
}

export async function getPhysicalQuantity(id: string): Promise<PhysicalQuantity> {
    const res = await apiFetch<{ quantity: PhysicalQuantity }>(`/physical-quantities/${id}`);
    return res.quantity;
}

export async function createPhysicalQuantity(
    data: CreatePhysicalQuantityRequest
): Promise<PhysicalQuantity> {
    const res = await apiFetch<{ quantity: PhysicalQuantity }>(`/physical-quantities`, {
        method: "POST",
        body: JSON.stringify(data),
    });
    return res.quantity;
}
