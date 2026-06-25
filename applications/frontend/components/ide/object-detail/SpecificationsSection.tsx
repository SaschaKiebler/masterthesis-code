"use client";

/**
 * SpecificationsSection — renders dynamic property form fields
 * based on the object type's property schema (ADR-014).
 * Displays between Info and Device Config in the detail panel.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { Section } from "./Section";
import { updateObjectProperties } from "@/lib/api/graph";
import type { PropertyFieldDefinition, PropertySchema } from "@/lib/api/types";
import { FileText } from "lucide-react";

interface SpecificationsSectionProps {
    objectId: string;
    propertySchemaJson?: string;
    propertiesJson?: string;
}

/** Parse the property schema from the object type. */
function parseSchema(json?: string): PropertyFieldDefinition[] {
    if (!json || json === "{}" || json.trim() === "") return [];
    try {
        const parsed = JSON.parse(json) as PropertySchema;
        if (Array.isArray(parsed.fields)) return parsed.fields;
        return [];
    } catch {
        return [];
    }
}

/** Extract custom property values from the object's properties blob. */
function parseCustomValues(json?: string): Record<string, unknown> {
    if (!json || json === "{}" || json.trim() === "") return {};
    try {
        const parsed = JSON.parse(json);
        if (parsed.custom && typeof parsed.custom === "object") return parsed.custom;
        return {};
    } catch {
        return {};
    }
}

export function SpecificationsSection({
    objectId,
    propertySchemaJson,
    propertiesJson,
}: SpecificationsSectionProps) {
    const fields = useMemo(() => parseSchema(propertySchemaJson), [propertySchemaJson]);
    const savedValues = useMemo(() => parseCustomValues(propertiesJson), [propertiesJson]);

    const [values, setValues] = useState<Record<string, unknown>>({});
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Tracks the last successfully saved state (updates on save AND on prop change)
    const baselineRef = useRef<Record<string, unknown>>(savedValues);

    // Reset local state when object or saved values change
    useEffect(() => {
        baselineRef.current = savedValues;
        setValues(savedValues);
        setError(null);
    }, [objectId, savedValues]);

    const isDirty = useMemo(() => {
        const baseline = baselineRef.current;
        return fields.some((f) => {
            const current = values[f.key];
            const saved = baseline[f.key];
            if (current === undefined && saved === undefined) return false;
            if (current === "" && saved === undefined) return false;
            return current !== saved;
        });
    }, [values, fields]);

    const handleChange = useCallback((key: string, value: unknown) => {
        setValues((prev) => ({ ...prev, [key]: value }));
    }, []);

    const handleSave = useCallback(async () => {
        setSaving(true);
        setError(null);
        try {
            // Only send fields that are defined in the schema
            const payload: Record<string, unknown> = {};
            for (const f of fields) {
                const v = values[f.key];
                if (v !== undefined && v !== "") {
                    payload[f.key] = v;
                }
            }
            await updateObjectProperties(objectId, payload);
            // Update baseline so isDirty resets, then force re-render via setValues
            const saved = { ...values };
            baselineRef.current = saved;
            setValues(saved);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to save");
        } finally {
            setSaving(false);
        }
    }, [objectId, values, fields]);

    const handleDiscard = useCallback(() => {
        setValues(baselineRef.current);
        setError(null);
    }, []);

    // Don't render if no schema is defined for this type
    if (fields.length === 0) return null;

    return (
        <Section
            title="Specs"
            tooltip="Fixed technical data like nominal size, flow rate, or manufacturer — does not change over time."
        >
            <div className="space-y-2">
                {error && (
                    <p className="text-xs text-danger">{error}</p>
                )}

                {fields.map((field) => (
                    <FieldInput
                        key={field.key}
                        field={field}
                        value={values[field.key]}
                        onChange={(v) => handleChange(field.key, v)}
                    />
                ))}

                {isDirty && (
                    <div className="flex gap-2 pt-1">
                        <Button size="sm" onClick={handleSave} loading={saving}>
                            Save
                        </Button>
                        <Button size="sm" variant="ghost" onClick={handleDiscard} disabled={saving}>
                            Discard
                        </Button>
                    </div>
                )}
            </div>
        </Section>
    );
}

// ─── Field input renderer ─────────────────────────────────────────────────────

function FieldInput({
    field,
    value,
    onChange,
}: {
    field: PropertyFieldDefinition;
    value: unknown;
    onChange: (value: unknown) => void;
}) {
    const inputClasses = "w-full h-7 px-2 text-xs bg-background border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary";

    switch (field.type) {
        case "text":
            return (
                <div className="flex items-center justify-between gap-2">
                    <label className="text-xs text-muted-foreground shrink-0">{field.label}</label>
                    <input
                        type="text"
                        value={(value as string) ?? ""}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder={field.description}
                        className={`${inputClasses} max-w-[180px]`}
                    />
                </div>
            );

        case "number":
            return (
                <div className="flex items-center justify-between gap-2">
                    <label className="text-xs text-muted-foreground shrink-0">{field.label}</label>
                    <div className="flex items-center gap-1">
                        <input
                            type="number"
                            value={value !== undefined && value !== null ? String(value) : ""}
                            onChange={(e) => {
                                const v = e.target.value;
                                onChange(v === "" ? undefined : parseFloat(v));
                            }}
                            min={field.min}
                            max={field.max}
                            step="any"
                            className={`${inputClasses} max-w-[120px] text-right`}
                        />
                        {field.unit && (
                            <span className="text-[10px] text-muted-foreground shrink-0 w-10">{field.unit}</span>
                        )}
                    </div>
                </div>
            );

        case "boolean":
            return (
                <div className="flex items-center justify-between gap-2">
                    <label className="text-xs text-muted-foreground">{field.label}</label>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={!!value}
                        onClick={() => onChange(!value)}
                        className={`relative w-8 h-4.5 rounded-full transition-colors ${
                            value ? "bg-primary" : "bg-border"
                        }`}
                    >
                        <span className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full bg-white transition-transform ${
                            value ? "translate-x-3.5" : ""
                        }`} />
                    </button>
                </div>
            );

        case "date":
            return (
                <div className="flex items-center justify-between gap-2">
                    <label className="text-xs text-muted-foreground shrink-0">{field.label}</label>
                    <input
                        type="date"
                        value={(value as string) ?? ""}
                        onChange={(e) => onChange(e.target.value || undefined)}
                        className={`${inputClasses} max-w-[160px]`}
                    />
                </div>
            );

        case "select":
            return (
                <div className="flex items-center justify-between gap-2">
                    <label className="text-xs text-muted-foreground shrink-0">{field.label}</label>
                    <select
                        value={(value as string) ?? ""}
                        onChange={(e) => onChange(e.target.value || undefined)}
                        className={`${inputClasses} max-w-[180px]`}
                    >
                        <option value="">—</option>
                        {field.options?.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                        ))}
                    </select>
                </div>
            );

        default:
            return null;
    }
}
