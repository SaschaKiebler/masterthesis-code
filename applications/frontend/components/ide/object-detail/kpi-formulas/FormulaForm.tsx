"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { AlertCircle, Loader2, Sparkles, X } from "lucide-react";
import {
    createKpiFormula,
    updateKpiFormula,
    generateKpiFormula,
    type KpiFormula,
    type FormulaVariable,
    type GenerateKpiFormulaResponse,
} from "@/lib/api/kpiFormulas";
import { getProjectMetricPoints, type ProjectMetricPoint } from "@/lib/api/projects";
import { VariableBindingRow } from "./VariableBindingRow";
import { extractVariableNames, slugify } from "./utils";

// ── FormulaForm (create + edit) ───────────────────────────────────────────────

export interface FormulaFormProps {
    objectId: string;
    projectId: string;
    /** When provided the form is in edit mode — fields are pre-filled and PATCH is called. */
    initialFormula?: KpiFormula;
    onSave: (formula: KpiFormula) => void;
    onCancel: () => void;
    /** Passed to the AI assistant for richer context (e.g. "HEAT_PUMP"). */
    objectTypeName?: string;
    /** Used in the AI textarea placeholder to orient the user. */
    objectDisplayName?: string;
}

export function FormulaForm({ objectId, projectId, initialFormula, onSave, onCancel, objectTypeName, objectDisplayName }: FormulaFormProps) {
    const isEdit = !!initialFormula;

    const [displayName, setDisplayName] = useState(initialFormula?.displayName ?? "");
    const [formula, setFormula]         = useState(initialFormula?.formula ?? "");
    const [unit, setUnit]               = useState(initialFormula?.unit ?? "");
    const [variables, setVariables]     = useState<Record<string, FormulaVariable>>(
        initialFormula?.variables ?? {}
    );
    const [saving, setSaving]           = useState(false);
    const [error, setError]             = useState<string | null>(null);
    const [metricPoints, setMetricPoints] = useState<ProjectMetricPoint[]>([]);

    // AI generation state
    const [aiPanelOpen, setAiPanelOpen]   = useState(false);
    const [aiPrompt, setAiPrompt]         = useState("");
    const [aiGenerating, setAiGenerating] = useState(false);
    const [aiResult, setAiResult]         = useState<GenerateKpiFormulaResponse | null>(null);
    const [aiError, setAiError]           = useState<string | null>(null);

    useEffect(() => {
        getProjectMetricPoints(projectId)
            .then((r) => setMetricPoints(r.metricPoints))
            .catch(() => {});
    }, [projectId]);

    const detectedVarNames = useMemo(() => extractVariableNames(formula), [formula]);

    // Keep variables map in sync with detected names; preserve existing bindings
    useEffect(() => {
        setVariables((prev) => {
            const next: Record<string, FormulaVariable> = {};
            for (const name of detectedVarNames) {
                next[name] = prev[name] ?? {
                    mode: "DIRECT",
                    label: name,
                    metricPointId: "",
                    aggregation: "LAST",
                };
            }
            return next;
        });
    }, [detectedVarNames.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

    const machineName = useMemo(() => slugify(displayName), [displayName]);

    const handleSubmit = useCallback(async () => {
        if (!displayName.trim()) { setError("Display name is required"); return; }
        if (!formula.trim())     { setError("Formula expression is required"); return; }
        if (!isEdit && !machineName) { setError("Could not derive machine name from display name"); return; }

        setSaving(true);
        setError(null);
        try {
            let saved: KpiFormula;
            if (isEdit) {
                saved = await updateKpiFormula(initialFormula!.id, {
                    displayName: displayName.trim(),
                    formula: formula.trim(),
                    variables,
                    unit: unit.trim() || undefined,
                });
            } else {
                saved = await createKpiFormula(objectId, {
                    name: machineName,
                    displayName: displayName.trim(),
                    formula: formula.trim(),
                    variables,
                    unit: unit.trim() || undefined,
                });
            }
            onSave(saved);
        } catch (e) {
            setError(e instanceof Error ? e.message : `Failed to ${isEdit ? "update" : "create"} formula`);
        } finally {
            setSaving(false);
        }
    }, [objectId, displayName, formula, machineName, unit, variables, isEdit, initialFormula, onSave]);

    const handleGenerate = useCallback(async () => {
        setAiGenerating(true);
        setAiError(null);
        try {
            const result = await generateKpiFormula(objectId, {
                prompt: aiPrompt,
                projectId,
            });
            setAiResult(result);
            setDisplayName(result.displayName);
            setFormula(result.formula);
            setUnit(result.unit ?? "");
            setVariables(result.variables);
        } catch (e) {
            setAiError(e instanceof Error ? e.message : "Generation failed");
        } finally {
            setAiGenerating(false);
        }
    }, [objectId, projectId, aiPrompt]);

    return (
        <div className="mt-2 p-3 rounded-lg bg-muted/50 border border-border space-y-2">
            {/* AI generate panel */}
            <div>
                <button
                    type="button"
                    onClick={() => setAiPanelOpen((v) => !v)}
                    className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                >
                    <Sparkles className="h-3 w-3" />
                    {aiPanelOpen ? "Hide AI assistant" : "Generate with AI"}
                </button>

                {aiPanelOpen && (
                    <div className="mt-1.5 space-y-1.5">
                        <textarea
                            value={aiPrompt}
                            onChange={(e) => setAiPrompt(e.target.value)}
                            placeholder={`e.g. Calculate the COP${objectDisplayName ? ` for ${objectDisplayName}` : ""} by dividing thermal output by electrical input`}
                            rows={2}
                            className="w-full text-xs px-2 py-1.5 rounded border border-border bg-background text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/50"
                        />
                        <div className="flex items-center gap-2 flex-wrap">
                            <button
                                type="button"
                                onClick={handleGenerate}
                                disabled={aiGenerating || !aiPrompt.trim()}
                                className="flex items-center gap-1 text-xs px-2.5 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                            >
                                {aiGenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                                {aiGenerating ? "Generating…" : "Generate"}
                            </button>
                            {aiError && (
                                <p className="text-[11px] text-red-500 flex items-center gap-1">
                                    <AlertCircle className="h-3 w-3 shrink-0" /> {aiError}
                                </p>
                            )}
                        </div>

                        {aiResult && (
                            <div className={`flex items-start gap-1.5 p-2 rounded border ${
                                aiResult.confidence >= 0.9
                                    ? "bg-emerald-500/10 border-emerald-500/20"
                                    : aiResult.confidence >= 0.7
                                    ? "bg-amber-500/10 border-amber-500/20"
                                    : "bg-red-500/10 border-red-500/20"
                            }`}>
                                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${
                                    aiResult.confidence >= 0.9
                                        ? "bg-emerald-500/15 text-emerald-600"
                                        : aiResult.confidence >= 0.7
                                        ? "bg-amber-500/15 text-amber-600"
                                        : "bg-red-500/15 text-red-600"
                                }`}>
                                    {Math.round(aiResult.confidence * 100)}%
                                </span>
                                <p className="text-[11px] text-muted-foreground flex-1 leading-relaxed">
                                    {aiResult.explanation}
                                </p>
                                <button
                                    type="button"
                                    onClick={() => setAiResult(null)}
                                    className="p-0.5 rounded text-muted-foreground hover:text-foreground shrink-0"
                                >
                                    <X className="h-3 w-3" />
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {isEdit && (
                <p className="text-[10px] text-muted-foreground font-mono">
                    Editing: {initialFormula!.name}
                </p>
            )}

            {/* Display name */}
            <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wide block mb-1">
                    Name
                </label>
                <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="e.g. Coefficient of Performance"
                    className="w-full text-xs h-7 px-2 rounded border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/50"
                />
                {!isEdit && machineName && (
                    <span className="text-[10px] text-muted-foreground font-mono mt-0.5 block">
                        key: {machineName}
                    </span>
                )}
            </div>

            {/* Unit */}
            <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wide block mb-1">
                    Unit (optional)
                </label>
                <input
                    type="text"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    placeholder="e.g. W/W, °C, kWh"
                    className="w-full text-xs h-7 px-2 rounded border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/50"
                />
            </div>

            {/* Formula */}
            <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wide block mb-1">
                    Formula
                </label>
                <input
                    type="text"
                    value={formula}
                    onChange={(e) => setFormula(e.target.value)}
                    placeholder="e.g. thermal_out / elec_in"
                    className="w-full text-xs h-7 px-2 font-mono rounded border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/50"
                />
                {detectedVarNames.length > 0 && (
                    <span className="text-[10px] text-muted-foreground mt-0.5 block">
                        Variables: {detectedVarNames.join(", ")}
                    </span>
                )}
            </div>

            {/* Variable bindings */}
            {detectedVarNames.length > 0 && (
                <div className="space-y-1.5">
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wide block">
                        Variable Bindings
                    </label>
                    {detectedVarNames.map((name) => (
                        <VariableBindingRow
                            key={name}
                            name={name}
                            binding={variables[name] ?? { mode: "DIRECT", label: name, metricPointId: "", aggregation: "LAST" }}
                            metricPoints={metricPoints}
                            onChange={(binding) => setVariables((prev) => ({ ...prev, [name]: binding }))}
                        />
                    ))}
                </div>
            )}

            {error && (
                <p className="text-[11px] text-red-500 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3 shrink-0" /> {error}
                </p>
            )}

            <div className="flex gap-2 pt-1">
                <button
                    onClick={handleSubmit}
                    disabled={saving}
                    className="flex items-center gap-1 text-xs px-2.5 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                    {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                    {isEdit ? "Update Formula" : "Save Formula"}
                </button>
                <button
                    onClick={onCancel}
                    className="text-xs px-2.5 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                    Cancel
                </button>
            </div>
        </div>
    );
}
