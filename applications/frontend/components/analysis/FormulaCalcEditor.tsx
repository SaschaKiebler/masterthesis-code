"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import type { ChartCalculation, ChartSource } from "@/lib/api/analysis";
import { buildFormulaVariableMap, FORMULA_FUNCTIONS } from "@/lib/api/analysis";

const FUNCTION_NAMES = new Set<string>(FORMULA_FUNCTIONS);

interface FormulaCalcEditorProps {
    calc: ChartCalculation;
    sources: ChartSource[];
    onSave: (updates: Partial<ChartCalculation>) => void;
    onClose: () => void;
}

function validateFormula(formula: string, variableMap: Record<string, string>): string | null {
    const trimmed = formula.trim();
    if (!trimmed) return "Formula is empty";

    let depth = 0;
    for (const ch of trimmed) {
        if (ch === "(") depth++;
        if (ch === ")") depth--;
        if (depth < 0) return "Unbalanced parentheses";
    }
    if (depth !== 0) return "Unbalanced parentheses";

    const names = trimmed.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) ?? [];
    const unknown = [...new Set(names.filter((n) => !FUNCTION_NAMES.has(n) && !(n in variableMap)))];
    if (unknown.length > 0) return `Unknown variable: ${unknown.join(", ")}`;

    if (!names.some((n) => n in variableMap)) return "Formula must reference at least one sensor variable";

    return null;
}

export function FormulaCalcEditor({ calc, sources, onSave, onClose }: FormulaCalcEditorProps) {
    const [formula, setFormula] = useState(String(calc.params?.formula ?? ""));
    const [showOnly, setShowOnly] = useState(Boolean(calc.params?.showOnly));

    const variableMap = useMemo(() => buildFormulaVariableMap(sources), [sources]);
    const error = useMemo(() => validateFormula(formula, variableMap), [formula, variableMap]);

    const handleSave = () => {
        if (error) return;
        const trimmed = formula.trim();
        onSave({
            label: trimmed,
            inputs: variableMap,
            params: { ...calc.params, formula: trimmed, showOnly },
        });
        onClose();
    };

    return (
        <div className="absolute z-50 bottom-full left-0 mb-1 w-80 bg-card border border-input rounded-lg shadow-lg overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-input">
                <span className="text-xs font-medium text-muted-foreground uppercase">Formula</span>
                <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
                    <X className="w-4 h-4" />
                </button>
            </div>

            <div className="p-3 space-y-3">
                <input
                    autoFocus
                    value={formula}
                    onChange={(e) => setFormula(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") handleSave();
                        if (e.key === "Escape") onClose();
                    }}
                    placeholder="e.g. (a - b) * 1.163"
                    spellCheck={false}
                    className="w-full font-mono text-sm bg-muted border border-input rounded px-2 py-1.5 text-foreground outline-none focus:border-primary"
                />

                {error && <p className="text-xs text-danger">{error}</p>}

                <div className="space-y-1">
                    <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                        Variables
                    </div>
                    {sources.map((src, i) => (
                        <div key={src.id} className="flex items-center gap-2 text-xs text-foreground">
                            <span className="font-mono font-semibold w-4">{Object.keys(variableMap)[i]}</span>
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: src.color }} />
                            <span className="truncate text-muted-foreground">= {src.label}</span>
                        </div>
                    ))}
                    <p className="text-[10px] text-muted-foreground pt-1">
                        Operators: + − * / ** ( ) · Functions: {FORMULA_FUNCTIONS.join(", ")}
                    </p>
                </div>

                <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
                    <input
                        type="checkbox"
                        checked={showOnly}
                        onChange={(e) => setShowOnly(e.target.checked)}
                        className="accent-primary"
                    />
                    Show only the formula result (hide sensor lines)
                </label>

                <div className="flex justify-end gap-2 pt-1">
                    <button
                        onClick={onClose}
                        className="px-3 py-1 text-xs rounded border border-input text-muted-foreground hover:text-foreground transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={!!error}
                        className="px-3 py-1 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        Apply
                    </button>
                </div>
            </div>
        </div>
    );
}
