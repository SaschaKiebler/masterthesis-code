/**
 * PropertySchemaBuilder
 *
 * Visual field-definition builder for ObjectType property schemas.
 * Replaces the raw JSON textarea with a structured UI where users
 * add, configure, and remove PropertyFieldDefinition entries.
 *
 * This is a controlled component: all state lives in the parent via
 * `value` / `onChange`. No "use client" directive is needed here
 * because the parent (ObjectTypeModal) already declares it.
 */

import { useState, useCallback, useId } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { PropertyFieldDefinition, PropertyFieldType } from "@/lib/api/types";

// ─── Props ────────────────────────────────────────────────────────────────────

interface PropertySchemaBuilderProps {
    value: PropertyFieldDefinition[];
    onChange: (fields: PropertyFieldDefinition[]) => void;
    disabled?: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STANDARD_FIELDS: PropertyFieldDefinition[] = [
    { key: "manufacturer",     label: "Manufacturer",     type: "text" },
    { key: "model_number",     label: "Model Number",     type: "text" },
    { key: "protocol",         label: "Protocol",         type: "text" },
    { key: "installation_date",label: "Installation Date",type: "date" },
    { key: "serial_number",    label: "Serial Number",    type: "text" },
    { key: "location_note",    label: "Location Note",    type: "text" },
];

const STANDARD_KEYS = new Set(STANDARD_FIELDS.map((f) => f.key));

const TYPE_LABELS: Record<PropertyFieldType, string> = {
    text:    "Text",
    number:  "Number",
    boolean: "Boolean",
    date:    "Date",
    select:  "Select",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Converts a human label to a snake_case key.
 * "DN Size" → "dn_size"
 */
function toSnakeCase(label: string): string {
    return label
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

// ─── SelectOptionsEditor ──────────────────────────────────────────────────────

interface SelectOptionsEditorProps {
    options: string[];
    optionInput: string;
    onOptionInputChange: (value: string) => void;
    onAddOption: () => void;
    onRemoveOption: (option: string) => void;
    disabled?: boolean;
    baseId: string;
}

function SelectOptionsEditor({
    options,
    optionInput,
    onOptionInputChange,
    onAddOption,
    onRemoveOption,
    disabled,
    baseId,
}: SelectOptionsEditorProps) {
    const inputId = `${baseId}-option-input`;

    function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key === "Enter") {
            e.preventDefault();
            onAddOption();
        }
    }

    return (
        <div className="mt-1.5 pl-2 border-l-2 border-border space-y-1.5">
            {/* Existing option chips */}
            {options.length > 0 && (
                <div
                    className="flex flex-wrap gap-1"
                    role="list"
                    aria-label="Select options"
                >
                    {options.map((opt) => (
                        <span
                            key={opt}
                            role="listitem"
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-xs font-medium"
                        >
                            {opt}
                            <button
                                type="button"
                                onClick={() => onRemoveOption(opt)}
                                disabled={disabled}
                                aria-label={`Remove option "${opt}"`}
                                className="rounded-full hover:text-danger focus:outline-none focus:ring-1 focus:ring-danger disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <X className="h-3 w-3" aria-hidden="true" />
                            </button>
                        </span>
                    ))}
                </div>
            )}

            {/* Add option input */}
            <div className="flex items-center gap-1.5">
                <label htmlFor={inputId} className="sr-only">
                    New option value
                </label>
                <input
                    id={inputId}
                    type="text"
                    value={optionInput}
                    onChange={(e) => onOptionInputChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Add option…"
                    disabled={disabled}
                    className={cn(
                        "flex-1 h-7 px-2 rounded border border-input bg-background",
                        "text-xs text-foreground placeholder:text-muted-foreground",
                        "focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary",
                        "disabled:opacity-50 disabled:cursor-not-allowed"
                    )}
                />
                <button
                    type="button"
                    onClick={onAddOption}
                    disabled={disabled || !optionInput.trim()}
                    aria-label="Add option"
                    className={cn(
                        "h-7 px-2 rounded border border-input bg-muted",
                        "text-xs text-foreground font-medium",
                        "hover:bg-secondary transition-colors",
                        "focus:outline-none focus:ring-1 focus:ring-primary/50",
                        "disabled:opacity-50 disabled:cursor-not-allowed"
                    )}
                >
                    Add
                </button>
            </div>
        </div>
    );
}

// ─── FieldRow ─────────────────────────────────────────────────────────────────

interface FieldRowProps {
    field: PropertyFieldDefinition;
    index: number;
    optionInput: string;
    onOptionInputChange: (value: string) => void;
    onAddOption: () => void;
    onRemoveOption: (option: string) => void;
    onFieldChange: (updated: PropertyFieldDefinition) => void;
    onDelete: () => void;
    disabled?: boolean;
}

function FieldRow({
    field,
    index,
    optionInput,
    onOptionInputChange,
    onAddOption,
    onRemoveOption,
    onFieldChange,
    onDelete,
    disabled,
}: FieldRowProps) {
    const baseId = useId();
    const isStandardKey = STANDARD_KEYS.has(field.key);

    function handleLabelChange(label: string) {
        // For standard fields the key is locked; for custom fields derive from label.
        const key = isStandardKey ? field.key : toSnakeCase(label);
        onFieldChange({ ...field, label, key });
    }

    function handleTypeChange(type: PropertyFieldType) {
        const updated: PropertyFieldDefinition = { ...field, type };
        // Clear type-specific props when switching away from their type.
        if (type !== "number") {
            delete updated.unit;
            delete updated.min;
            delete updated.max;
        }
        if (type !== "select") {
            delete updated.options;
        }
        onFieldChange(updated);
    }

    const labelId  = `${baseId}-label`;
    const typeId   = `${baseId}-type`;
    const unitId   = `${baseId}-unit`;
    const reqId    = `${baseId}-required`;

    return (
        <div className="rounded-lg border border-border bg-card p-2 space-y-1.5">
            {/* Main row */}
            <div className="flex items-center gap-2">
                {/* Label input */}
                <div className="flex-1 min-w-0">
                    <label htmlFor={labelId} className="sr-only">
                        Field label
                    </label>
                    <input
                        id={labelId}
                        type="text"
                        value={field.label}
                        onChange={(e) => handleLabelChange(e.target.value)}
                        placeholder="Label…"
                        disabled={disabled}
                        aria-label={`Label for field ${index + 1}`}
                        className={cn(
                            "w-full h-7 px-2 rounded border border-input bg-background",
                            "text-xs text-foreground placeholder:text-muted-foreground",
                            "focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary",
                            "disabled:opacity-50 disabled:cursor-not-allowed"
                        )}
                    />
                    {/* Key preview (only shown when not a standard key) */}
                    {!isStandardKey && field.key && (
                        <p className="mt-0.5 text-[10px] text-muted-foreground truncate" aria-live="polite">
                            key: <span className="font-mono">{field.key}</span>
                        </p>
                    )}
                    {isStandardKey && (
                        <p className="mt-0.5 text-[10px] text-muted-foreground truncate">
                            key: <span className="font-mono">{field.key}</span>{" "}
                            <span className="text-primary/70">(standard)</span>
                        </p>
                    )}
                </div>

                {/* Type select */}
                <div className="shrink-0">
                    <label htmlFor={typeId} className="sr-only">
                        Field type
                    </label>
                    <select
                        id={typeId}
                        value={field.type}
                        onChange={(e) => handleTypeChange(e.target.value as PropertyFieldType)}
                        disabled={disabled}
                        aria-label={`Type for field ${index + 1}`}
                        className={cn(
                            "h-7 px-1.5 rounded border border-input bg-background",
                            "text-xs text-foreground",
                            "focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary",
                            "disabled:opacity-50 disabled:cursor-not-allowed"
                        )}
                    >
                        {(Object.keys(TYPE_LABELS) as PropertyFieldType[]).map((t) => (
                            <option key={t} value={t}>{TYPE_LABELS[t]}</option>
                        ))}
                    </select>
                </div>

                {/* Unit input — only for number type */}
                {field.type === "number" && (
                    <div className="shrink-0 w-16">
                        <label htmlFor={unitId} className="sr-only">
                            Unit
                        </label>
                        <input
                            id={unitId}
                            type="text"
                            value={field.unit ?? ""}
                            onChange={(e) =>
                                onFieldChange({ ...field, unit: e.target.value || undefined })
                            }
                            placeholder="Unit"
                            disabled={disabled}
                            aria-label={`Unit for field ${index + 1}`}
                            className={cn(
                                "w-full h-7 px-2 rounded border border-input bg-background",
                                "text-xs text-foreground placeholder:text-muted-foreground",
                                "focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary",
                                "disabled:opacity-50 disabled:cursor-not-allowed"
                            )}
                        />
                    </div>
                )}

                {/* Required checkbox */}
                <div className="shrink-0 flex items-center gap-1">
                    <input
                        id={reqId}
                        type="checkbox"
                        checked={field.required ?? false}
                        onChange={(e) =>
                            onFieldChange({ ...field, required: e.target.checked || undefined })
                        }
                        disabled={disabled}
                        className="h-3.5 w-3.5 rounded border-input accent-primary disabled:cursor-not-allowed"
                    />
                    <label htmlFor={reqId} className="text-xs text-muted-foreground select-none cursor-pointer">
                        Req
                    </label>
                </div>

                {/* Delete button */}
                <button
                    type="button"
                    onClick={onDelete}
                    disabled={disabled}
                    aria-label={`Remove field "${field.label || field.key}"`}
                    className={cn(
                        "shrink-0 flex items-center justify-center h-7 w-7 rounded",
                        "text-muted-foreground hover:text-danger hover:bg-danger/10",
                        "transition-colors focus:outline-none focus:ring-1 focus:ring-danger/50",
                        "disabled:opacity-50 disabled:cursor-not-allowed"
                    )}
                >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
            </div>

            {/* Select options sub-row */}
            {field.type === "select" && (
                <SelectOptionsEditor
                    options={field.options ?? []}
                    optionInput={optionInput}
                    onOptionInputChange={onOptionInputChange}
                    onAddOption={onAddOption}
                    onRemoveOption={onRemoveOption}
                    disabled={disabled}
                    baseId={baseId}
                />
            )}
        </div>
    );
}

// ─── PropertySchemaBuilder ────────────────────────────────────────────────────

/**
 * Visual builder for an array of PropertyFieldDefinition objects.
 *
 * Usage:
 * ```tsx
 * <PropertySchemaBuilder
 *   value={fields}
 *   onChange={setFields}
 *   disabled={isSubmitting}
 * />
 * ```
 */
export function PropertySchemaBuilder({
    value,
    onChange,
    disabled = false,
}: PropertySchemaBuilderProps) {
    /**
     * Per-field transient state for the "add option" input.
     * Keyed by field index. Not part of the schema — lives here only.
     */
    const [optionInputs, setOptionInputs] = useState<Record<number, string>>({});

    // ── Field-level helpers ──────────────────────────────────────────────────

    const updateField = useCallback(
        (index: number, updated: PropertyFieldDefinition) => {
            const next = [...value];
            next[index] = updated;
            onChange(next);
        },
        [value, onChange]
    );

    const deleteField = useCallback(
        (index: number) => {
            const next = value.filter((_, i) => i !== index);
            onChange(next);
            // Clean up transient option input for the removed row.
            setOptionInputs((prev) => {
                const updated: Record<number, string> = {};
                Object.entries(prev).forEach(([k, v]) => {
                    const ki = Number(k);
                    if (ki < index) updated[ki] = v;
                    else if (ki > index) updated[ki - 1] = v;
                    // ki === index is dropped
                });
                return updated;
            });
        },
        [value, onChange]
    );

    const addCustomField = useCallback(() => {
        onChange([
            ...value,
            { key: "", label: "", type: "text" },
        ]);
    }, [value, onChange]);

    const addStandardField = useCallback(
        (field: PropertyFieldDefinition) => {
            onChange([...value, { ...field }]);
        },
        [value, onChange]
    );

    // ── Option helpers ───────────────────────────────────────────────────────

    function handleAddOption(index: number) {
        const input = (optionInputs[index] ?? "").trim();
        if (!input) return;
        const field = value[index];
        const existing = field.options ?? [];
        if (existing.includes(input)) return; // no duplicates
        updateField(index, { ...field, options: [...existing, input] });
        setOptionInputs((prev) => ({ ...prev, [index]: "" }));
    }

    function handleRemoveOption(index: number, option: string) {
        const field = value[index];
        updateField(index, {
            ...field,
            options: (field.options ?? []).filter((o) => o !== option),
        });
    }

    // ── Derived ──────────────────────────────────────────────────────────────

    const existingKeys = new Set(value.map((f) => f.key));
    const availableStandardFields = STANDARD_FIELDS.filter(
        (sf) => !existingKeys.has(sf.key)
    );

    // ── Render ───────────────────────────────────────────────────────────────

    return (
        <div className="space-y-3">
            {/* ── Standard field quick-add ── */}
            {availableStandardFields.length > 0 && (
                <div>
                    <p className="text-xs text-muted-foreground mb-1.5">
                        Quick-add standard fields:
                    </p>
                    <div className="flex flex-wrap gap-1.5" role="list" aria-label="Standard fields">
                        {availableStandardFields.map((sf) => (
                            <button
                                key={sf.key}
                                type="button"
                                role="listitem"
                                onClick={() => addStandardField(sf)}
                                disabled={disabled}
                                aria-label={`Add standard field: ${sf.label}`}
                                className={cn(
                                    "inline-flex items-center gap-1 px-2 py-0.5 rounded-full",
                                    "border border-dashed border-border",
                                    "text-xs text-muted-foreground",
                                    "hover:border-primary hover:text-primary hover:bg-primary/5",
                                    "transition-colors focus:outline-none focus:ring-1 focus:ring-primary/50",
                                    "disabled:opacity-50 disabled:cursor-not-allowed"
                                )}
                            >
                                <Plus className="h-3 w-3" aria-hidden="true" />
                                {sf.label}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* ── Field rows ── */}
            {value.length > 0 && (
                <div className="space-y-2" role="list" aria-label="Property fields">
                    {value.map((field, index) => (
                        <div key={`${field.key}-${index}`} role="listitem">
                            <FieldRow
                                field={field}
                                index={index}
                                optionInput={optionInputs[index] ?? ""}
                                onOptionInputChange={(v) =>
                                    setOptionInputs((prev) => ({ ...prev, [index]: v }))
                                }
                                onAddOption={() => handleAddOption(index)}
                                onRemoveOption={(opt) => handleRemoveOption(index, opt)}
                                onFieldChange={(updated) => updateField(index, updated)}
                                onDelete={() => deleteField(index)}
                                disabled={disabled}
                            />
                        </div>
                    ))}
                </div>
            )}

            {/* ── Empty state ── */}
            {value.length === 0 && (
                <p className="text-xs text-muted-foreground italic">
                    No fields defined yet. Add standard fields above or create a custom field.
                </p>
            )}

            {/* ── Add custom field button ── */}
            <button
                type="button"
                onClick={addCustomField}
                disabled={disabled}
                className={cn(
                    "w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg",
                    "border border-dashed border-border",
                    "text-xs text-muted-foreground",
                    "hover:border-primary hover:text-primary hover:bg-primary/5",
                    "transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50",
                    "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
            >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Add Custom Field
            </button>
        </div>
    );
}
