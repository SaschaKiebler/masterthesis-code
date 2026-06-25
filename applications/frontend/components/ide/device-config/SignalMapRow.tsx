"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import type { SignalMapEntry } from "@/lib/api/types";

interface SignalMapRowProps {
    metricId: string;
    entry: SignalMapEntry;
    onUpdate: (field: keyof SignalMapEntry, value: string) => void;
    onRemove: () => void;
}

export function SignalMapRow({
    metricId,
    entry,
    onUpdate,
    onRemove,
}: SignalMapRowProps) {
    const [expanded, setExpanded] = useState(false);

    return (
        <div className="p-1.5 border border-border rounded bg-background/50">
            <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-mono text-muted-foreground w-6 shrink-0 text-right tabular-nums">
                    {metricId}
                </span>
                <input
                    value={entry.name}
                    onChange={(e) => onUpdate("name", e.target.value)}
                    placeholder="Metric name"
                    className="flex-1 h-6 px-1.5 text-xs bg-transparent border-none text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
                />
                <input
                    value={entry.unit ?? ""}
                    onChange={(e) => onUpdate("unit", e.target.value)}
                    placeholder="unit"
                    className="w-16 h-6 px-1.5 text-xs bg-transparent border-none text-muted-foreground placeholder:text-muted-foreground/40 focus:outline-none"
                />
                <button
                    onClick={() => setExpanded(!expanded)}
                    className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
                    title="Expand details"
                >
                    {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </button>
                <button
                    onClick={onRemove}
                    className="p-0.5 rounded text-muted-foreground hover:text-danger transition-colors"
                    title="Remove metric"
                >
                    <Trash2 className="h-3 w-3" />
                </button>
            </div>
            {expanded && (
                <div className="mt-1.5 pl-7 space-y-2">
                    <div className="flex gap-1.5">
                        <div className="flex-1">
                            <label className="text-[10px] text-muted-foreground">Source</label>
                            <input
                                value={entry.source ?? ""}
                                onChange={(e) => onUpdate("source", e.target.value)}
                                placeholder="e.g. em:0"
                                className="w-full h-6 px-1.5 text-xs bg-background border border-border rounded text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                        </div>
                        <div className="flex-1">
                            <label className="text-[10px] text-muted-foreground">Field</label>
                            <input
                                value={entry.field ?? ""}
                                onChange={(e) => onUpdate("field", e.target.value)}
                                placeholder="e.g. a_act_power"
                                className="w-full h-6 px-1.5 text-xs bg-background border border-border rounded text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
