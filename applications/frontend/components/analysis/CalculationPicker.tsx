"use client";

import { useState } from "react";
import { X } from "lucide-react";
import type { ChartSource, ChartCalculation, CalculationType } from "@/lib/api/analysis";
import { buildFormulaVariableMap } from "@/lib/api/analysis";

// Calculation types whose result is a line series and can feed other calculations
const DERIVED_INPUT_TYPES = new Set<CalculationType>(["difference", "formula", "moving_average", "sum", "ratio"]);

interface CalculationOption {
    type: CalculationType;
    label: string;
    description: string;
    category: "overlay" | "derived";
    needsInputs: "single" | "pair" | "all" | "none";
}

const CALCULATION_OPTIONS: CalculationOption[] = [
    { type: "mean", label: "Mean", description: "Horizontal mean line", category: "overlay", needsInputs: "single" },
    { type: "median", label: "Median", description: "Horizontal median line", category: "overlay", needsInputs: "single" },
    { type: "moving_average", label: "Moving Avg", description: "Rolling average (24h)", category: "overlay", needsInputs: "single" },
    { type: "min_max_band", label: "Min/Max Band", description: "Shaded min-max range", category: "overlay", needsInputs: "single" },
    { type: "std_band", label: "Std Dev Band", description: "Mean ± 1σ band", category: "overlay", needsInputs: "single" },
    { type: "trend", label: "Trend Line", description: "Linear trend", category: "overlay", needsInputs: "single" },
    { type: "reference_line", label: "Reference", description: "Fixed value line", category: "overlay", needsInputs: "none" },
    { type: "difference", label: "Difference", description: "A − B", category: "derived", needsInputs: "pair" },
    { type: "regression", label: "Regression", description: "Linear fit + R²", category: "derived", needsInputs: "pair" },
    { type: "formula", label: "Formula", description: "Custom expression, e.g. (a − b) * 2", category: "derived", needsInputs: "all" },
];

interface CalculationPickerProps {
    sources: ChartSource[];
    calculations: ChartCalculation[];
    onSelect: (type: CalculationType, inputs: Record<string, string>) => void;
    onClose: () => void;
}

export function CalculationPicker({ sources, calculations, onSelect, onClose }: CalculationPickerProps) {
    // Single-input calculations can target a sensor or a derived series (e.g. a formula result)
    const targets = [
        ...sources.map((s) => ({ id: s.id, label: s.label })),
        ...calculations.filter((c) => DERIVED_INPUT_TYPES.has(c.type)).map((c) => ({ id: c.id, label: c.label })),
    ];
    const [targetId, setTargetId] = useState(targets[0]?.id ?? "");

    const handleSelect = (option: CalculationOption) => {
        let inputs: Record<string, string> = {};

        if (option.needsInputs === "single" && targets.length > 0) {
            inputs = { source: targetId || targets[0].id };
        } else if (option.needsInputs === "pair" && sources.length >= 2) {
            inputs = { a: sources[0].id, b: sources[1].id };
        } else if (option.needsInputs === "all") {
            inputs = buildFormulaVariableMap(sources);
        }

        onSelect(option.type, inputs);
    };

    return (
        <div className="absolute z-50 bottom-full left-0 mb-1 w-64 bg-card border border-input rounded-lg shadow-lg overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-input">
                <span className="text-xs font-medium text-muted-foreground uppercase">Add Calculation</span>
                <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
                    <X className="w-4 h-4" />
                </button>
            </div>

            <div className="p-1">
                <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Per Series
                </div>
                {targets.length > 1 && (
                    <div className="flex items-center gap-1.5 px-2 pb-1.5">
                        <span className="text-[10px] text-muted-foreground shrink-0">on</span>
                        <select
                            value={targetId}
                            onChange={(e) => setTargetId(e.target.value)}
                            className="w-full text-xs bg-muted border border-input rounded px-1.5 py-0.5 text-foreground"
                        >
                            {targets.map((t) => (
                                <option key={t.id} value={t.id}>{t.label}</option>
                            ))}
                        </select>
                    </div>
                )}
                {CALCULATION_OPTIONS.filter((o) => o.category === "overlay").map((option) => {
                    const disabled = option.needsInputs === "single" && targets.length === 0;
                    return (
                        <button
                            key={option.type}
                            onClick={() => !disabled && handleSelect(option)}
                            disabled={disabled}
                            className="w-full text-left px-2 py-1.5 rounded text-sm hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <span className="text-foreground">{option.label}</span>
                            <span className="text-xs text-muted-foreground ml-2">{option.description}</span>
                        </button>
                    );
                })}

                <div className="px-2 py-1 mt-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Multi-Sensor
                </div>
                {CALCULATION_OPTIONS.filter((o) => o.category === "derived").map((option) => {
                    const disabled =
                        (option.needsInputs === "pair" && sources.length < 2) ||
                        (option.needsInputs === "all" && sources.length === 0);
                    return (
                        <button
                            key={option.type}
                            onClick={() => !disabled && handleSelect(option)}
                            disabled={disabled}
                            className="w-full text-left px-2 py-1.5 rounded text-sm hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <span className="text-foreground">{option.label}</span>
                            <span className="text-xs text-muted-foreground ml-2">
                                {option.description}
                                {disabled && (option.needsInputs === "pair" ? " (needs 2+ sensors)" : " (needs a sensor)")}
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
