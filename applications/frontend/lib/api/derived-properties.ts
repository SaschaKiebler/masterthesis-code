/**
 * Derived Properties API (ADR-013)
 * ML/pipeline computed values written back onto ontology objects.
 */

import { apiFetch, buildQueryString } from "./client";

export type DerivedPropertyQuality = "GOOD" | "STALE" | "LOW_CONFIDENCE" | "INSUFFICIENT_DATA";
export type DerivedPropertySourceType = "RULE" | "PIPELINE" | "MODEL" | "AGGREGATION";

export interface DerivedProperty {
    id: string;
    objectId: string;
    propertyName: string;
    displayName: string;
    valueNumeric?: number;
    valueText?: string;
    unit?: string;
    confidence?: number;
    quality: DerivedPropertyQuality;
    sourceType: DerivedPropertySourceType;
    sourceId?: string;
    sourceVersion?: string;
    computedAt: string; // ISO timestamp
    validFrom: string;
    validUntil?: string;
}

export interface DerivedPropertiesResponse {
    derivedProperties: DerivedProperty[];
}

export interface WriteDerivedPropertyRequest {
    objectId: string;
    propertyName: string;
    displayName?: string;
    valueNumeric?: number;
    valueText?: string;
    unit?: string;
    confidence?: number;
    quality?: DerivedPropertyQuality;
    sourceType?: DerivedPropertySourceType;
    sourceId?: string;
    sourceVersion?: string;
}

export const QUALITY_BADGE: Record<DerivedPropertyQuality, { label: string; classes: string }> = {
    GOOD:               { label: "Good",              classes: "bg-emerald-100 text-emerald-700" },
    STALE:              { label: "Stale",             classes: "bg-amber-100 text-amber-700" },
    LOW_CONFIDENCE:     { label: "Low Confidence",    classes: "bg-amber-100 text-amber-700" },
    INSUFFICIENT_DATA:  { label: "Insufficient Data", classes: "bg-gray-100 text-gray-500" },
};

export const SOURCE_BADGE: Record<DerivedPropertySourceType, { label: string; classes: string }> = {
    MODEL:       { label: "ML Model",    classes: "bg-violet-100 text-violet-700" },
    PIPELINE:    { label: "Pipeline",    classes: "bg-blue-100 text-blue-700" },
    AGGREGATION: { label: "Aggregation", classes: "bg-sky-100 text-sky-700" },
    RULE:        { label: "Rule",        classes: "bg-gray-100 text-gray-700" },
};

export async function getObjectDerivedProperties(objectId: string): Promise<DerivedProperty[]> {
    const res = await apiFetch<DerivedPropertiesResponse>(
        `/objects/${objectId}/derived-properties`
    );
    return res.derivedProperties;
}

export async function queryDerivedProperties(params?: {
    propertyName?: string;
    objectTypes?: string;
}): Promise<DerivedProperty[]> {
    const qs = params ? buildQueryString(params as Record<string, unknown>) : "";
    const res = await apiFetch<DerivedPropertiesResponse>(`/derived-properties${qs}`);
    return res.derivedProperties;
}

export async function writeDerivedProperty(
    data: WriteDerivedPropertyRequest
): Promise<DerivedProperty> {
    const res = await apiFetch<{ derivedProperty: DerivedProperty }>(`/derived-properties`, {
        method: "POST",
        body: JSON.stringify(data),
    });
    return res.derivedProperty;
}
