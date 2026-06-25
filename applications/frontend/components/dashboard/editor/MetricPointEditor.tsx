"use client";

/**
 * MetricPointEditor — manage metric points for a single object (device).
 *
 * Displays the list of registered metric points for the given objectId
 * and provides add / delete operations. Intended for use in device settings
 * panels; NOT the dashboard editor widget config panel.
 *
 * Usage:
 *   <MetricPointEditor objectId="<uuid>" />
 */

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/Button";
import {
    getMetricPoints,
    createMetricPoint,
    deleteMetricPoint,
    type MetricPoint,
    type CreateMetricPointRequest,
} from "@/lib/api/metric-points";
import { Plus, Trash2, Activity, ChevronDown, ChevronUp } from "lucide-react";

// ─── Props ───────────────────────────────────────────────────────────────────

interface MetricPointEditorProps {
    /** The ontology object ID (device) whose metric points are managed. */
    objectId: string;
    /** Optional tenant ID forwarded to the creation request. */
    tenantId?: string;
    /** Optional CSS class applied to the outermost wrapper. */
    className?: string;
}

// ─── Add form state ──────────────────────────────────────────────────────────

interface AddFormState {
    deviceId: string;
    metricId: string;   // kept as string for controlled input; converted on submit
    quantityName: string;
    unit: string;
    source: string;
    field: string;
}

const EMPTY_FORM: AddFormState = {
    deviceId: "",
    metricId: "",
    quantityName: "",
    unit: "",
    source: "",
    field: "",
};

// ─── Component ───────────────────────────────────────────────────────────────

export function MetricPointEditor({
    objectId,
    tenantId,
    className,
}: MetricPointEditorProps) {
    const [metricPoints, setMetricPoints] = useState<MetricPoint[]>([]);
    const [loading, setLoading] = useState(true);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    // Add-form visibility and state
    const [showAddForm, setShowAddForm] = useState(false);
    const [form, setForm] = useState<AddFormState>(EMPTY_FORM);
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);

    // ─── Fetch on mount / when objectId changes ───────────────────────────

    const refresh = useCallback(() => {
        setLoading(true);
        getMetricPoints(objectId)
            .then(setMetricPoints)
            .catch(() => setMetricPoints([]))
            .finally(() => setLoading(false));
    }, [objectId]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    // ─── Delete ───────────────────────────────────────────────────────────

    const handleDelete = useCallback(async (id: string) => {
        setDeletingId(id);
        try {
            await deleteMetricPoint(id);
            setMetricPoints((prev) => prev.filter((mp) => mp.id !== id));
        } catch {
            // Silently ignore — the row stays; user can retry
        } finally {
            setDeletingId(null);
        }
    }, []);

    // ─── Add ──────────────────────────────────────────────────────────────

    const handleFormChange = useCallback(
        <K extends keyof AddFormState>(field: K, value: AddFormState[K]) => {
            setForm((prev) => ({ ...prev, [field]: value }));
            setFormError(null);
        },
        []
    );

    const handleAddSubmit = useCallback(async () => {
        const metricIdNum = Number(form.metricId);
        if (!form.deviceId.trim()) {
            setFormError("Device ID is required.");
            return;
        }
        if (!form.metricId.trim() || isNaN(metricIdNum) || metricIdNum < 0) {
            setFormError("Metric ID must be a non-negative number.");
            return;
        }
        if (!form.unit.trim()) {
            setFormError("Unit is required.");
            return;
        }

        setSaving(true);
        setFormError(null);
        try {
            const payload: CreateMetricPointRequest = {
                deviceId: form.deviceId.trim(),
                metricId: metricIdNum,
                unit: form.unit.trim(),
                quantityName: form.quantityName.trim() || undefined,
                source: form.source.trim() || undefined,
                field: form.field.trim() || undefined,
                tenantId,
            };
            const created = await createMetricPoint(objectId, payload);
            setMetricPoints((prev) => [...prev, created]);
            setForm(EMPTY_FORM);
            setShowAddForm(false);
        } catch {
            setFormError("Failed to create metric point. Please try again.");
        } finally {
            setSaving(false);
        }
    }, [form, objectId, tenantId]);

    const handleCancelAdd = useCallback(() => {
        setForm(EMPTY_FORM);
        setFormError(null);
        setShowAddForm(false);
    }, []);

    // ─── Render ───────────────────────────────────────────────────────────

    return (
        <div className={cn("space-y-3", className)}>
            {/* Header row */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                    <Activity className="h-4 w-4 text-muted-foreground" />
                    <h3 className="text-sm font-semibold text-foreground">Metric Points</h3>
                    {!loading && (
                        <span className="text-xs text-muted-foreground">
                            ({metricPoints.length})
                        </span>
                    )}
                </div>
                <button
                    onClick={() => setShowAddForm((v) => !v)}
                    className={cn(
                        "flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors",
                        showAddForm
                            ? "bg-muted text-foreground"
                            : "bg-primary/10 text-primary hover:bg-primary/20"
                    )}
                >
                    {showAddForm ? (
                        <>
                            <ChevronUp className="h-3 w-3" /> Cancel
                        </>
                    ) : (
                        <>
                            <Plus className="h-3 w-3" /> Add
                        </>
                    )}
                </button>
            </div>

            {/* Add form */}
            {showAddForm && (
                <div className="p-3 border border-border rounded-lg bg-muted/30 space-y-2.5">
                    <p className="text-xs font-medium text-foreground">New Metric Point</p>

                    {/* Device ID */}
                    <FormField label="Device ID" required>
                        <input
                            value={form.deviceId}
                            onChange={(e) => handleFormChange("deviceId", e.target.value)}
                            placeholder="e.g. device_001"
                            className={inputCls}
                        />
                    </FormField>

                    {/* Metric ID */}
                    <FormField label="Metric ID" required>
                        <input
                            type="number"
                            min={0}
                            value={form.metricId}
                            onChange={(e) => handleFormChange("metricId", e.target.value)}
                            placeholder="e.g. 42"
                            className={inputCls}
                        />
                    </FormField>

                    {/* Quantity Name */}
                    <FormField label="Quantity Name">
                        <input
                            value={form.quantityName}
                            onChange={(e) => handleFormChange("quantityName", e.target.value)}
                            placeholder="e.g. temperature"
                            className={inputCls}
                        />
                    </FormField>

                    {/* Unit */}
                    <FormField label="Unit" required>
                        <input
                            value={form.unit}
                            onChange={(e) => handleFormChange("unit", e.target.value)}
                            placeholder="e.g. °C"
                            className={inputCls}
                        />
                    </FormField>

                    {/* Source */}
                    <FormField label="Source">
                        <input
                            value={form.source}
                            onChange={(e) => handleFormChange("source", e.target.value)}
                            placeholder="e.g. mqtt"
                            className={inputCls}
                        />
                    </FormField>

                    {/* Field */}
                    <FormField label="Field">
                        <input
                            value={form.field}
                            onChange={(e) => handleFormChange("field", e.target.value)}
                            placeholder="e.g. temp_celsius"
                            className={inputCls}
                        />
                    </FormField>

                    {/* Validation error */}
                    {formError && (
                        <p className="text-xs text-danger">{formError}</p>
                    )}

                    {/* Action buttons */}
                    <div className="flex gap-2 pt-1">
                        <Button
                            size="sm"
                            variant="primary"
                            onClick={handleAddSubmit}
                            loading={saving}
                            disabled={saving}
                        >
                            Save
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={handleCancelAdd}
                            disabled={saving}
                        >
                            Cancel
                        </Button>
                    </div>
                </div>
            )}

            {/* Metric points table */}
            {loading ? (
                <div className="flex items-center justify-center py-6">
                    <p className="text-xs text-muted-foreground">Loading metric points...</p>
                </div>
            ) : metricPoints.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-6 text-center">
                    <Activity className="h-6 w-6 text-muted-foreground/30 mb-2" />
                    <p className="text-sm text-muted-foreground">No metric points registered.</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">
                        Click Add to register the first metric point for this device.
                    </p>
                </div>
            ) : (
                <div className="rounded-lg border border-border overflow-hidden">
                    {/* Table header */}
                    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_3rem] gap-x-3 px-3 py-2 bg-muted/50 border-b border-border">
                        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Device ID</span>
                        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Metric</span>
                        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Quantity</span>
                        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide text-right">Unit</span>
                    </div>

                    {/* Rows */}
                    {metricPoints.map((mp) => (
                        <MetricPointRow
                            key={mp.id}
                            metricPoint={mp}
                            deleting={deletingId === mp.id}
                            onDelete={() => handleDelete(mp.id)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── Metric Point Row ────────────────────────────────────────────────────────

interface MetricPointRowProps {
    metricPoint: MetricPoint;
    deleting: boolean;
    onDelete: () => void;
}

function MetricPointRow({ metricPoint: mp, deleting, onDelete }: MetricPointRowProps) {
    const [confirmDelete, setConfirmDelete] = useState(false);

    const quantityLabel =
        mp.quantityDisplayName ?? mp.quantityName ?? mp.field ?? `Metric ${mp.metricId}`;

    return (
        <div
            className={cn(
                "grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_3rem] gap-x-3 px-3 py-2.5 border-b border-border/50 last:border-b-0 text-xs items-center transition-colors",
                deleting ? "opacity-40" : "hover:bg-muted/20"
            )}
        >
            {/* Device ID */}
            <span className="truncate font-mono text-foreground" title={mp.deviceId}>
                {mp.deviceId}
            </span>

            {/* Metric ID */}
            <span className="tabular-nums text-muted-foreground shrink-0">
                #{mp.metricId}
            </span>

            {/* Quantity name */}
            <span className="truncate text-muted-foreground" title={quantityLabel}>
                {quantityLabel}
            </span>

            {/* Unit + delete */}
            <div className="flex items-center justify-end gap-2">
                <span className="font-mono text-muted-foreground shrink-0">{mp.unit}</span>
                {confirmDelete ? (
                    <div className="flex items-center gap-1">
                        <button
                            onClick={onDelete}
                            disabled={deleting}
                            className="text-[10px] text-danger hover:text-danger/80 font-medium transition-colors disabled:opacity-50"
                        >
                            Confirm
                        </button>
                        <button
                            onClick={() => setConfirmDelete(false)}
                            disabled={deleting}
                            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                        >
                            Cancel
                        </button>
                    </div>
                ) : (
                    <button
                        onClick={() => setConfirmDelete(true)}
                        disabled={deleting}
                        className="p-0.5 rounded text-muted-foreground/40 hover:text-danger transition-colors disabled:opacity-30"
                        title="Delete metric point"
                    >
                        <Trash2 className="h-3 w-3" />
                    </button>
                )}
            </div>
        </div>
    );
}

// ─── Form Field helper ───────────────────────────────────────────────────────

function FormField({
    label,
    required,
    children,
}: {
    label: string;
    required?: boolean;
    children: React.ReactNode;
}) {
    return (
        <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-24 shrink-0">
                {label}
                {required && <span className="text-danger ml-0.5">*</span>}
            </span>
            {children}
        </div>
    );
}

// ─── Shared class strings ────────────────────────────────────────────────────

const inputCls =
    "flex-1 h-7 px-2 text-xs bg-background border border-border rounded text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary";
