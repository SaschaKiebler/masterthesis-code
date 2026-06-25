"use client";

import { useState, useMemo } from "react";
import {
    type FormulaVariable,
    type DirectVariable,
    type TraverseVariable,
} from "@/lib/api/kpiFormulas";
import { type ProjectMetricPoint } from "@/lib/api/projects";
import { LINK_TYPE_OPTIONS, TRAVERSE_AGGREGATIONS } from "./utils";

// ── VariableBindingRow ────────────────────────────────────────────────────────

export interface VariableBindingRowProps {
    name: string;
    binding: FormulaVariable;
    metricPoints: ProjectMetricPoint[];
    onChange: (binding: FormulaVariable) => void;
}

export function VariableBindingRow({ name, binding, metricPoints, onChange }: VariableBindingRowProps) {
    const isDirect = binding.mode === "DIRECT";
    const [mpSearch, setMpSearch] = useState("");

    const filteredMps = useMemo(() => {
        const q = mpSearch.toLowerCase();
        return metricPoints.filter(
            (mp) =>
                !q ||
                (mp.displayName ?? "").toLowerCase().includes(q) ||
                mp.assetName.toLowerCase().includes(q) ||
                (mp.quantityDisplayName ?? "").toLowerCase().includes(q)
        ).slice(0, 30);
    }, [metricPoints, mpSearch]);

    // Grouped options for traverse mode quantity picker:
    // group 1 — physical quantities (quantityName → quantityDisplayName label)
    // group 2 — metric names (objects.display_name) not already covered by a physical quantity
    const quantityOptions = useMemo(() => {
        const physical = new Map<string, string>(); // value → label
        const named = new Set<string>();
        for (const mp of metricPoints) {
            if (mp.quantityName) {
                const label = mp.quantityDisplayName
                    ? `${mp.quantityName} · ${mp.quantityDisplayName}`
                    : mp.quantityName;
                physical.set(mp.quantityName, label);
            }
            if (mp.displayName && !physical.has(mp.displayName)) {
                named.add(mp.displayName);
            }
        }
        return {
            physical: [...physical.entries()]
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([value, label]) => ({ value, label })),
            named: [...named]
                .sort()
                .map((v) => ({ value: v, label: v })),
        };
    }, [metricPoints]);

    return (
        <div className="rounded-md border border-border/60 bg-muted/30 p-2 space-y-1.5">
            {/* Variable name + mode toggle */}
            <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono font-semibold text-primary min-w-[60px]">
                    {name}
                </span>
                <div className="flex gap-1 flex-1">
                    <button
                        onClick={() => onChange({ mode: "DIRECT", label: binding.label, metricPointId: "", aggregation: "LAST" })}
                        className={`flex-1 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded transition-colors ${
                            isDirect
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        Direct
                    </button>
                    <button
                        onClick={() => onChange({
                            mode: "TRAVERSE", label: binding.label,
                            quantityName: "", linkTypeName: "FEEDS",
                            direction: "OUTBOUND", aggregation: "SUM",
                        })}
                        className={`flex-1 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded transition-colors ${
                            !isDirect
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        Graph
                    </button>
                </div>
            </div>

            {/* Label */}
            <input
                type="text"
                value={binding.label}
                onChange={(e) => onChange({ ...binding, label: e.target.value } as FormulaVariable)}
                placeholder="Label (e.g. Thermal Energy)"
                className="w-full text-xs h-6 px-2 rounded border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/50"
            />

            {isDirect ? (
                /* Direct mode: metric point picker */
                <div>
                    <input
                        type="text"
                        value={mpSearch}
                        onChange={(e) => setMpSearch(e.target.value)}
                        placeholder="Search metric points..."
                        className="w-full text-xs h-6 px-2 rounded border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/50 mb-1"
                    />
                    <select
                        value={(binding as DirectVariable).metricPointId}
                        onChange={(e) => onChange({ ...(binding as DirectVariable), metricPointId: e.target.value })}
                        className="w-full text-xs h-7 px-2 rounded border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        size={1}
                    >
                        <option value="">— select metric point —</option>
                        {filteredMps.map((mp) => (
                            <option key={mp.id} value={mp.id}>
                                {mp.assetName} › {mp.displayName ?? mp.quantityDisplayName ?? `metric_${mp.metricId}`}
                                {mp.unit ? ` (${mp.unit})` : ""}
                            </option>
                        ))}
                    </select>
                </div>
            ) : (
                /* Traverse mode */
                <div className="grid grid-cols-2 gap-1.5">
                    {/* Quantity */}
                    <div>
                        <label className="text-[9px] text-muted-foreground uppercase tracking-wide block mb-0.5">Quantity / Metric</label>
                        <select
                            value={(binding as TraverseVariable).quantityName}
                            onChange={(e) => onChange({ ...(binding as TraverseVariable), quantityName: e.target.value })}
                            className="w-full text-xs h-7 px-2 rounded border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        >
                            <option value="">— select —</option>
                            {quantityOptions.physical.length > 0 && (
                                <optgroup label="Physical Quantities">
                                    {quantityOptions.physical.map(({ value, label }) => (
                                        <option key={value} value={value}>{label}</option>
                                    ))}
                                </optgroup>
                            )}
                            {quantityOptions.named.length > 0 && (
                                <optgroup label="Metric Names">
                                    {quantityOptions.named.map(({ value, label }) => (
                                        <option key={value} value={value}>{label}</option>
                                    ))}
                                </optgroup>
                            )}
                        </select>
                    </div>

                    {/* Link type */}
                    <div>
                        <label className="text-[9px] text-muted-foreground uppercase tracking-wide block mb-0.5">Link type</label>
                        <select
                            value={(binding as TraverseVariable).linkTypeName}
                            onChange={(e) => onChange({ ...(binding as TraverseVariable), linkTypeName: e.target.value })}
                            className="w-full text-xs h-7 px-2 rounded border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        >
                            {LINK_TYPE_OPTIONS.map((lt) => <option key={lt} value={lt}>{lt}</option>)}
                        </select>
                    </div>

                    {/* Direction */}
                    <div>
                        <label className="text-[9px] text-muted-foreground uppercase tracking-wide block mb-0.5">Direction</label>
                        <div className="flex gap-1">
                            <button
                                onClick={() => onChange({ ...(binding as TraverseVariable), direction: "OUTBOUND" })}
                                className={`flex-1 text-[10px] font-semibold px-1 py-0.5 rounded transition-colors ${
                                    (binding as TraverseVariable).direction === "OUTBOUND"
                                        ? "bg-primary text-primary-foreground"
                                        : "bg-muted text-muted-foreground"
                                }`}
                            >
                                Out
                            </button>
                            <button
                                onClick={() => onChange({ ...(binding as TraverseVariable), direction: "INBOUND" })}
                                className={`flex-1 text-[10px] font-semibold px-1 py-0.5 rounded transition-colors ${
                                    (binding as TraverseVariable).direction === "INBOUND"
                                        ? "bg-primary text-primary-foreground"
                                        : "bg-muted text-muted-foreground"
                                }`}
                            >
                                In
                            </button>
                        </div>
                    </div>

                    {/* Aggregation */}
                    <div>
                        <label className="text-[9px] text-muted-foreground uppercase tracking-wide block mb-0.5">Aggregation</label>
                        <select
                            value={(binding as TraverseVariable).aggregation}
                            onChange={(e) => onChange({ ...(binding as TraverseVariable), aggregation: e.target.value as TraverseVariable["aggregation"] })}
                            className="w-full text-xs h-7 px-2 rounded border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        >
                            {TRAVERSE_AGGREGATIONS.map((a) => <option key={a} value={a}>{a}</option>)}
                        </select>
                    </div>
                </div>
            )}
        </div>
    );
}
