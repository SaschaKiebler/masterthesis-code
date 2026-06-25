"use client";

import { useState, useCallback } from "react";
import { Trash2, Loader2, Play, Pencil } from "lucide-react";
import { type KpiFormula } from "@/lib/api/kpiFormulas";

// ── FormulaRow ────────────────────────────────────────────────────────────────

export interface FormulaRowProps {
    formula: KpiFormula;
    onToggle: (enabled: boolean) => Promise<void>;
    onDelete: () => Promise<void>;
    onEvaluate: () => Promise<void>;
    onEdit: () => void;
}

export function FormulaRow({ formula, onToggle, onDelete, onEvaluate, onEdit }: FormulaRowProps) {
    const [toggling, setToggling]     = useState(false);
    const [deleting, setDeleting]     = useState(false);
    const [evaluating, setEvaluating] = useState(false);

    const handleToggle = useCallback(async () => {
        setToggling(true);
        try { await onToggle(!formula.enabled); }
        finally { setToggling(false); }
    }, [formula.enabled, onToggle]);

    const handleDelete = useCallback(async () => {
        if (!confirm(`Delete formula "${formula.displayName}"?`)) return;
        setDeleting(true);
        try { await onDelete(); }
        finally { setDeleting(false); }
    }, [formula.displayName, onDelete]);

    const handleEvaluate = useCallback(async () => {
        setEvaluating(true);
        try { await onEvaluate(); }
        finally { setEvaluating(false); }
    }, [onEvaluate]);

    return (
        <div className={`flex items-center gap-2 py-1.5 px-2 rounded-lg ${formula.enabled ? "" : "opacity-50"}`}>
            {/* Formula preview */}
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-foreground truncate">
                        {formula.displayName}
                    </span>
                    {formula.unit && (
                        <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                            [{formula.unit}]
                        </span>
                    )}
                </div>
                <span className="text-[10px] font-mono text-muted-foreground/70 block truncate">
                    {formula.formula}
                </span>
            </div>

            {/* Evaluate button */}
            <button
                onClick={handleEvaluate}
                disabled={evaluating}
                title="Evaluate now"
                className="p-0.5 rounded text-muted-foreground hover:text-emerald-500 hover:bg-emerald-500/10 transition-colors shrink-0"
            >
                {evaluating
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : <Play className="h-3 w-3" />
                }
            </button>

            {/* Edit button */}
            <button
                onClick={onEdit}
                title="Edit formula"
                className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
            >
                <Pencil className="h-3 w-3" />
            </button>

            {/* Enable toggle */}
            <button
                onClick={handleToggle}
                disabled={toggling}
                title={formula.enabled ? "Disable formula" : "Enable formula"}
                className={`relative w-7 h-4 p-0 rounded-full overflow-hidden transition-colors shrink-0 ${
                    formula.enabled ? "bg-primary" : "bg-muted-foreground/30"
                } ${toggling ? "opacity-50" : ""}`}
            >
                <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform ${
                    formula.enabled ? "translate-x-0.5" : "-translate-x-3.5"
                }`} />
            </button>

            {/* Delete */}
            <button
                onClick={handleDelete}
                disabled={deleting}
                className="p-0.5 rounded text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors shrink-0"
                title="Delete formula"
            >
                {deleting
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : <Trash2 className="h-3 w-3" />
                }
            </button>
        </div>
    );
}
