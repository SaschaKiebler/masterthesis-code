"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Brain, AlertCircle, Loader2 } from "lucide-react";
import { Section } from "./Section";
import {
    listKpiFormulas,
    updateKpiFormula,
    deleteKpiFormula,
    evaluateKpiFormula,
    type KpiFormula,
} from "@/lib/api/kpiFormulas";
import { FormulaRow } from "./kpi-formulas/FormulaRow";
import { FormulaForm } from "./kpi-formulas/FormulaForm";

// ── Main section ──────────────────────────────────────────────────────────────

interface KpiFormulasSectionProps {
    objectId: string;
    projectId: string;
    objectTypeName?: string;
    objectDisplayName?: string;
}

export function KpiFormulasSection({ objectId, projectId, objectTypeName, objectDisplayName }: KpiFormulasSectionProps) {
    const [formulas, setFormulas]           = useState<KpiFormula[]>([]);
    const [loading, setLoading]             = useState(true);
    const [error, setError]                 = useState<string | null>(null);
    const [showAddForm, setShowAddForm]     = useState(false);
    const [editingId, setEditingId]         = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await listKpiFormulas(objectId);
            setFormulas(data);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load formulas");
        } finally {
            setLoading(false);
        }
    }, [objectId]);

    useEffect(() => { load(); }, [load]);

    const handleAdd = useCallback((formula: KpiFormula) => {
        setFormulas((prev) => [...prev, formula]);
        setShowAddForm(false);
    }, []);

    const handleUpdated = useCallback((updated: KpiFormula) => {
        setFormulas((prev) => prev.map((f) => f.id === updated.id ? updated : f));
        setEditingId(null);
    }, []);

    const handleToggle = useCallback(async (formulaId: string, enabled: boolean) => {
        const updated = await updateKpiFormula(formulaId, { enabled });
        setFormulas((prev) => prev.map((f) => f.id === formulaId ? updated : f));
    }, []);

    const handleDelete = useCallback(async (formulaId: string) => {
        await deleteKpiFormula(formulaId);
        setFormulas((prev) => prev.filter((f) => f.id !== formulaId));
        if (editingId === formulaId) setEditingId(null);
    }, [editingId]);

    const handleEvaluate = useCallback(async (formulaId: string) => {
        await evaluateKpiFormula(formulaId);
    }, []);

    return (
        <Section
            title="Computed KPIs"
            count={formulas.length}
            action={
                <button
                    onClick={() => { setShowAddForm((v) => !v); setEditingId(null); }}
                    className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    title="Add KPI formula"
                >
                    <Plus className="h-3.5 w-3.5" />
                </button>
            }
        >
            {loading && (
                <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading formulas…
                </div>
            )}

            {error && (
                <p className="text-[11px] text-red-500 flex items-center gap-1 py-1">
                    <AlertCircle className="h-3 w-3 shrink-0" /> {error}
                </p>
            )}

            {!loading && !error && formulas.length === 0 && !showAddForm && (
                <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                    <Brain className="h-3.5 w-3.5 shrink-0" />
                    No KPI formulas. Click + to define one.
                </div>
            )}

            {!loading && formulas.map((formula) =>
                editingId === formula.id ? (
                    <FormulaForm
                        key={formula.id}
                        objectId={objectId}
                        projectId={projectId}
                        initialFormula={formula}
                        onSave={handleUpdated}
                        onCancel={() => setEditingId(null)}
                        objectTypeName={objectTypeName}
                        objectDisplayName={objectDisplayName}
                    />
                ) : (
                    <FormulaRow
                        key={formula.id}
                        formula={formula}
                        onToggle={(enabled) => handleToggle(formula.id, enabled)}
                        onDelete={() => handleDelete(formula.id)}
                        onEvaluate={() => handleEvaluate(formula.id)}
                        onEdit={() => { setEditingId(formula.id); setShowAddForm(false); }}
                    />
                )
            )}

            {showAddForm && (
                <FormulaForm
                    objectId={objectId}
                    projectId={projectId}
                    onSave={handleAdd}
                    onCancel={() => setShowAddForm(false)}
                    objectTypeName={objectTypeName}
                    objectDisplayName={objectDisplayName}
                />
            )}
        </Section>
    );
}
