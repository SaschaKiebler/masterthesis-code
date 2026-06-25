/**
 * Signal Map Editor
 * Visually configure what each data channel (metric) measures.
 */

"use client";

import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Settings2, Plus, Trash2 } from "lucide-react";
import type { SignalEntry } from "@/lib/utils/signal-map";
import { COMMON_UNITS, COMMON_SOURCES, nextMetricId } from "@/lib/utils/signal-map";

interface SignalMapStepProps {
    entries: SignalEntry[];
    onChange: (entries: SignalEntry[]) => void;
}

export function SignalMapStep({ entries, onChange }: SignalMapStepProps) {
    function addEntry() {
        onChange([...entries, { metricId: nextMetricId(entries), name: "", unit: "", min: "", max: "", source: "", field: "" }]);
    }

    function updateEntry(index: number, field: keyof SignalEntry, value: string) {
        const updated = [...entries];
        updated[index] = { ...updated[index], [field]: value };
        onChange(updated);
    }

    function removeEntry(index: number) {
        onChange(entries.filter((_, i) => i !== index));
    }

    return (
        <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
                Define what each data channel (metric) measures. This determines how readings are displayed.
            </p>

            {entries.length === 0 ? (
                <EmptyState onAdd={addEntry} />
            ) : (
                <>
                    <div className="space-y-3 max-h-64 overflow-y-auto">
                        {entries.map((entry, index) => (
                            <SignalEntryCard
                                key={index}
                                entry={entry}
                                onUpdate={(field, value) => updateEntry(index, field, value)}
                                onRemove={() => removeEntry(index)}
                            />
                        ))}
                    </div>
                    <Button type="button" variant="ghost" size="sm" onClick={addEntry}>
                        <Plus className="h-4 w-4 mr-1" aria-hidden="true" />
                        Add Channel
                    </Button>
                </>
            )}
        </div>
    );
}

// --- Sub-components ---

function EmptyState({ onAdd }: { onAdd: () => void }) {
    return (
        <div className="text-center py-6 border border-dashed border-border rounded-lg">
            <Settings2 className="h-8 w-8 text-muted-foreground mx-auto mb-2" aria-hidden="true" />
            <p className="text-sm text-muted-foreground mb-3">
                No signals configured yet.
            </p>
            <Button type="button" variant="ghost" size="sm" onClick={onAdd}>
                <Plus className="h-4 w-4 mr-1" aria-hidden="true" />
                Add Signal Channel
            </Button>
        </div>
    );
}

function SignalEntryCard({
    entry,
    onUpdate,
    onRemove,
}: {
    entry: SignalEntry;
    onUpdate: (field: keyof SignalEntry, value: string) => void;
    onRemove: () => void;
}) {
    return (
        <div className="p-3 rounded-lg border border-border bg-muted/30 space-y-2">
            <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                    Channel {entry.metricId}
                </span>
                <button
                    type="button"
                    onClick={onRemove}
                    className="p-1 rounded text-muted-foreground hover:text-danger hover:bg-danger/10 transition-colors"
                    aria-label={`Remove channel ${entry.metricId}`}
                >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
                <Input
                    label="Metric ID"
                    placeholder="e.g. 1"
                    value={entry.metricId}
                    onChange={(e) => onUpdate("metricId", e.target.value)}
                />
                <Input
                    label="Name"
                    placeholder="e.g. flow_temperature"
                    value={entry.name}
                    onChange={(e) => onUpdate("name", e.target.value)}
                />
            </div>

            <div className="grid grid-cols-3 gap-2">
                <Select
                    label="Unit"
                    value={entry.unit}
                    onChange={(e) => onUpdate("unit", e.target.value)}
                >
                    <option value="">None</option>
                    {COMMON_UNITS.map((u) => (
                        <option key={u} value={u}>{u}</option>
                    ))}
                </Select>
                <Input
                    label="Min"
                    type="number"
                    placeholder="Min"
                    value={entry.min}
                    onChange={(e) => onUpdate("min", e.target.value)}
                />
                <Input
                    label="Max"
                    type="number"
                    placeholder="Max"
                    value={entry.max}
                    onChange={(e) => onUpdate("max", e.target.value)}
                />
            </div>

            <div className="grid grid-cols-2 gap-2">
                <div>
                    <Input
                        label="Source"
                        placeholder="e.g. em:0"
                        value={entry.source}
                        onChange={(e) => onUpdate("source", e.target.value)}
                        list="source-suggestions"
                    />
                    <datalist id="source-suggestions">
                        {COMMON_SOURCES.map((s) => (
                            <option key={s} value={s} />
                        ))}
                    </datalist>
                </div>
                <Input
                    label="Field"
                    placeholder="e.g. a_act_power"
                    value={entry.field}
                    onChange={(e) => onUpdate("field", e.target.value)}
                />
            </div>
        </div>
    );
}
