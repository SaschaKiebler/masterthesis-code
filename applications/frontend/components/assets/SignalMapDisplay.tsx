/**
 * Signal Map Display & Editor
 * Shows signal map entries as human-readable cards.
 * Toggle to edit mode for inline editing + save to backend.
 */

"use client";

import { useState, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { SignalMapStep } from "@/components/assets/SignalMapStep";
import { updateAssetSignalMap } from "@/lib/api/spaces";
import { parseSignalMap, signalEntriesToJson } from "@/lib/utils/signal-map";
import type { SignalEntry } from "@/lib/utils/signal-map";
import { ApiError } from "@/lib/api/client";
import { Pencil, X, Save, Activity } from "lucide-react";

interface SignalMapDisplayProps {
    assetId: string;
    signalMapJson: string;
    onUpdate: () => void;
}

const UNIT_LABELS: Record<string, string> = {
    celsius: "°C",
    fahrenheit: "°F",
    kelvin: "K",
    percent: "%",
    hPa: "hPa",
    bar: "bar",
    psi: "psi",
    kWh: "kWh",
    Wh: "Wh",
    W: "W",
    kW: "kW",
    "m3/h": "m³/h",
    m3: "m³",
    "l/min": "L/min",
    "l/h": "L/h",
    l: "L",
    V: "V",
    A: "A",
    Hz: "Hz",
    ppm: "ppm",
    dB: "dB",
    lux: "lux",
};

function formatUnit(unit: string): string {
    return UNIT_LABELS[unit] || unit;
}

function formatSignalName(name: string): string {
    return name
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function SignalMapDisplay({ assetId, signalMapJson, onUpdate }: SignalMapDisplayProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [entries, setEntries] = useState<SignalEntry[]>([]);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const parsed = parseSignalMap(signalMapJson);

    const startEditing = useCallback(() => {
        setEntries(parseSignalMap(signalMapJson));
        setIsEditing(true);
        setError(null);
    }, [signalMapJson]);

    const cancelEditing = useCallback(() => {
        setIsEditing(false);
        setError(null);
    }, []);

    async function handleSave() {
        setIsSaving(true);
        setError(null);
        try {
            const json = signalEntriesToJson(entries);
            await updateAssetSignalMap(assetId, json);
            setIsEditing(false);
            onUpdate();
        } catch (err) {
            if (err instanceof ApiError) {
                setError(err.message || "Failed to update signal map.");
            } else {
                setError("Network error. Please try again.");
            }
        } finally {
            setIsSaving(false);
        }
    }

    if (parsed.length === 0 && !isEditing) {
        return (
            <Card variant="bordered">
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <CardTitle>Signal Map</CardTitle>
                        <Button variant="ghost" size="sm" onClick={startEditing}>
                            <Pencil className="h-4 w-4 mr-1" aria-hidden="true" />
                            Configure
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground text-center py-4">
                        No signal map configured. Add one to see human-readable measurement labels.
                    </p>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card variant="elevated">
            <CardHeader>
                <div className="flex items-center justify-between">
                    <CardTitle>Signal Map</CardTitle>
                    {isEditing ? (
                        <div className="flex gap-1.5">
                            <Button variant="ghost" size="sm" onClick={cancelEditing} disabled={isSaving}>
                                <X className="h-4 w-4 mr-1" aria-hidden="true" />
                                Cancel
                            </Button>
                            <Button variant="primary" size="sm" onClick={handleSave} loading={isSaving}>
                                <Save className="h-4 w-4 mr-1" aria-hidden="true" />
                                {isSaving ? "Saving..." : "Save"}
                            </Button>
                        </div>
                    ) : (
                        <Button variant="ghost" size="sm" onClick={startEditing}>
                            <Pencil className="h-4 w-4 mr-1" aria-hidden="true" />
                            Edit
                        </Button>
                    )}
                </div>
            </CardHeader>
            <CardContent>
                {error && (
                    <div className="p-3 mb-4 rounded-lg bg-danger/10 border border-danger/20 text-sm text-danger" role="alert">
                        {error}
                    </div>
                )}

                {isEditing ? (
                    <SignalMapStep entries={entries} onChange={setEntries} />
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {parsed.map((signal) => (
                            <SignalCard key={signal.metricId} signal={signal} />
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

function SignalCard({ signal }: { signal: SignalEntry }) {
    const hasRange = signal.min !== "" || signal.max !== "";
    const unit = signal.unit ? formatUnit(signal.unit) : null;
    const hasMapping = signal.source || signal.field;

    return (
        <div className="p-3 rounded-lg border border-border space-y-1.5">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                    <Activity className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                    <span className="text-xs text-muted-foreground">Ch {signal.metricId}</span>
                </div>
                {unit && <Badge variant="secondary" size="sm">{unit}</Badge>}
            </div>
            <p className="font-medium text-foreground text-sm">
                {formatSignalName(signal.name || "Unknown")}
            </p>
            {hasRange && (
                <p className="text-xs text-muted-foreground">
                    Range: {signal.min !== "" ? signal.min : "—"} – {signal.max !== "" ? signal.max : "—"}
                    {unit ? ` ${unit}` : ""}
                </p>
            )}
            {hasMapping && (
                <p className="text-xs text-muted-foreground font-mono">
                    {signal.source}{signal.field ? ` → ${signal.field}` : ""}
                </p>
            )}
        </div>
    );
}

/**
 * Helper: resolve a metricId to a human-readable label from a signal map JSON string.
 */
export function resolveSignalLabel(signalMapJson: string, metricId: number): { name: string; unit: string } {
    try {
        const map = JSON.parse(signalMapJson || "{}");
        const entry = map[String(metricId)];
        if (entry) {
            return {
                name: formatSignalName(entry.name || `Metric ${metricId}`),
                unit: entry.unit ? formatUnit(entry.unit) : "",
            };
        }
    } catch { /* ignore */ }
    return { name: `Metric ${metricId}`, unit: "" };
}
