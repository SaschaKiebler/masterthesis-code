"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Trash2, AlertCircle, Bell, Loader2, ToggleLeft } from "lucide-react";
import { Section } from "./Section";
import {
    listThresholdRules,
    createThresholdRule,
    updateThresholdRule,
    deleteThresholdRule,
    isStateChangeOperator,
    type ThresholdRule,
    type RuleOperator,
    type RuleSeverity,
} from "@/lib/api/thresholdRules";

// ── Helpers ───────────────────────────────────────────────────────────────────

const OPERATOR_LABELS: Record<RuleOperator, string> = {
    GT:               ">",
    LT:               "<",
    GTE:              "≥",
    LTE:              "≤",
    CHANGED_TO_TRUE:  "→ ON",
    CHANGED_TO_FALSE: "→ OFF",
};

const SEVERITY_STYLES: Record<RuleSeverity, string> = {
    INFO:     "bg-blue-500/10 text-blue-500 border border-blue-500/20",
    WARNING:  "bg-amber-500/10 text-amber-500 border border-amber-500/20",
    ERROR:    "bg-orange-500/10 text-orange-500 border border-orange-500/20",
    CRITICAL: "bg-red-500/10 text-red-600 border border-red-500/20",
};

function formatCooldown(seconds: number): string {
    if (seconds < 60)   return `${seconds}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    return `${Math.round(seconds / 3600)}h`;
}

// ── Add rule form ─────────────────────────────────────────────────────────────

type RuleMode = "threshold" | "state_change";

interface AddRuleFormProps {
    onSave: (data: {
        operator: RuleOperator;
        threshold?: number;
        severity: RuleSeverity;
        cooldownSeconds: number;
    }) => Promise<void>;
    onCancel: () => void;
}

function AddRuleForm({ onSave, onCancel }: AddRuleFormProps) {
    const [mode, setMode]           = useState<RuleMode>("threshold");
    const [operator, setOperator]   = useState<RuleOperator>("GT");
    const [stateOp, setStateOp]     = useState<RuleOperator>("CHANGED_TO_TRUE");
    const [threshold, setThreshold] = useState("");
    const [severity, setSeverity]   = useState<RuleSeverity>("WARNING");
    const [cooldown, setCooldown]   = useState("300");

    // Reset cooldown default when switching modes
    const handleModeChange = useCallback((next: RuleMode) => {
        setMode(next);
        setCooldown(next === "state_change" ? "0" : "300");
    }, []);
    const [saving, setSaving]       = useState(false);
    const [error, setError]         = useState<string | null>(null);

    const handleSubmit = useCallback(async () => {
        const cooldownSec = parseInt(cooldown, 10);
        if (isNaN(cooldownSec) || cooldownSec < 0) { setError("Cooldown must be ≥ 0"); return; }

        let finalOperator: RuleOperator;
        let finalThreshold: number | undefined;

        if (mode === "state_change") {
            finalOperator = stateOp;
            finalThreshold = undefined;
        } else {
            finalOperator = operator;
            const parsed = parseFloat(threshold);
            if (isNaN(parsed)) { setError("Threshold must be a number"); return; }
            finalThreshold = parsed;
        }

        setSaving(true);
        setError(null);
        try {
            await onSave({ operator: finalOperator, threshold: finalThreshold, severity, cooldownSeconds: cooldownSec });
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to create rule");
        } finally {
            setSaving(false);
        }
    }, [mode, operator, stateOp, threshold, severity, cooldown, onSave]);

    return (
        <div className="mt-2 p-3 rounded-lg bg-muted/50 border border-border space-y-2">
            {/* Rule type toggle */}
            <div className="flex gap-1">
                <button
                    onClick={() => handleModeChange("threshold")}
                    className={`flex-1 text-[10px] font-semibold uppercase tracking-wide px-2 py-1 rounded transition-colors ${
                        mode === "threshold"
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground hover:text-foreground"
                    }`}
                >
                    Threshold
                </button>
                <button
                    onClick={() => handleModeChange("state_change")}
                    className={`flex-1 flex items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-2 py-1 rounded transition-colors ${
                        mode === "state_change"
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground hover:text-foreground"
                    }`}
                >
                    <ToggleLeft className="h-3 w-3" />
                    State Change
                </button>
            </div>

            {mode === "threshold" ? (
                <div className="grid grid-cols-2 gap-2">
                    {/* Operator */}
                    <div>
                        <label className="text-[10px] text-muted-foreground uppercase tracking-wide block mb-1">
                            Operator
                        </label>
                        <select
                            value={operator}
                            onChange={(e) => setOperator(e.target.value as RuleOperator)}
                            className="w-full text-xs h-7 px-2 rounded border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        >
                            <option value="GT">{">"} greater than</option>
                            <option value="LT">{"<"} less than</option>
                            <option value="GTE">≥ at least</option>
                            <option value="LTE">≤ at most</option>
                        </select>
                    </div>

                    {/* Threshold */}
                    <div>
                        <label className="text-[10px] text-muted-foreground uppercase tracking-wide block mb-1">
                            Threshold
                        </label>
                        <input
                            type="number"
                            value={threshold}
                            onChange={(e) => setThreshold(e.target.value)}
                            placeholder="e.g. 85"
                            className="w-full text-xs h-7 px-2 rounded border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/50"
                        />
                    </div>
                </div>
            ) : (
                <div>
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wide block mb-1">
                        Trigger when value switches to
                    </label>
                    <div className="flex gap-1.5">
                        <button
                            onClick={() => setStateOp("CHANGED_TO_TRUE")}
                            className={`flex-1 text-xs font-semibold py-1 rounded border transition-colors ${
                                stateOp === "CHANGED_TO_TRUE"
                                    ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-500"
                                    : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                            }`}
                        >
                            ON (true)
                        </button>
                        <button
                            onClick={() => setStateOp("CHANGED_TO_FALSE")}
                            className={`flex-1 text-xs font-semibold py-1 rounded border transition-colors ${
                                stateOp === "CHANGED_TO_FALSE"
                                    ? "bg-red-500/15 border-red-500/40 text-red-500"
                                    : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                            }`}
                        >
                            OFF (false)
                        </button>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">
                        Fires once per transition, not while the state holds.
                    </p>
                </div>
            )}

            <div className="grid grid-cols-2 gap-2">
                {/* Severity */}
                <div>
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wide block mb-1">
                        Severity
                    </label>
                    <select
                        value={severity}
                        onChange={(e) => setSeverity(e.target.value as RuleSeverity)}
                        className="w-full text-xs h-7 px-2 rounded border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                        <option value="INFO">Info</option>
                        <option value="WARNING">Warning</option>
                        <option value="ERROR">Error</option>
                        <option value="CRITICAL">Critical</option>
                    </select>
                </div>

                {/* Cooldown */}
                <div>
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wide block mb-1">
                        Cooldown (sec)
                    </label>
                    <input
                        type="number"
                        value={cooldown}
                        onChange={(e) => setCooldown(e.target.value)}
                        min="0"
                        className="w-full text-xs h-7 px-2 rounded border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                </div>
            </div>

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
                    Add Rule
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

// ── Rule row ──────────────────────────────────────────────────────────────────

interface RuleRowProps {
    rule: ThresholdRule;
    onToggle: (enabled: boolean) => Promise<void>;
    onDelete: () => Promise<void>;
}

function RuleRow({ rule, onToggle, onDelete }: RuleRowProps) {
    const [toggling, setToggling] = useState(false);
    const [deleting, setDeleting] = useState(false);

    const handleToggle = useCallback(async () => {
        setToggling(true);
        try { await onToggle(!rule.enabled); }
        finally { setToggling(false); }
    }, [rule.enabled, onToggle]);

    const handleDelete = useCallback(async () => {
        if (!confirm("Delete this alert rule?")) return;
        setDeleting(true);
        try { await onDelete(); }
        finally { setDeleting(false); }
    }, [onDelete]);

    const isStateChange = isStateChangeOperator(rule.operator);

    return (
        <div className={`flex items-center gap-2 py-1.5 px-2 rounded-lg ${rule.enabled ? "" : "opacity-50"}`}>
            {/* Condition */}
            <span className="text-xs font-mono font-medium text-foreground whitespace-nowrap">
                {isStateChange
                    ? OPERATOR_LABELS[rule.operator]
                    : `${OPERATOR_LABELS[rule.operator]} ${rule.threshold}`}
            </span>

            {/* Severity badge */}
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide ${SEVERITY_STYLES[rule.severity]}`}>
                {rule.severity}
            </span>

            {/* Cooldown */}
            <span className="text-[10px] text-muted-foreground ml-auto whitespace-nowrap">
                {formatCooldown(rule.cooldownSeconds)} cooldown
            </span>

            {/* Enabled toggle */}
            <button
                onClick={handleToggle}
                disabled={toggling}
                title={rule.enabled ? "Disable rule" : "Enable rule"}
                className={`relative w-7 h-4 p-0 rounded-full overflow-hidden transition-colors shrink-0 ${
                    rule.enabled ? "bg-primary" : "bg-muted-foreground/30"
                } ${toggling ? "opacity-50" : ""}`}
            >
                <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform ${
                    rule.enabled ? "translate-x-3.5" : "translate-x-0.5"
                }`} />
            </button>

            {/* Delete */}
            <button
                onClick={handleDelete}
                disabled={deleting}
                className="p-0.5 rounded text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors shrink-0"
                title="Delete rule"
            >
                {deleting
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : <Trash2 className="h-3 w-3" />
                }
            </button>
        </div>
    );
}

// ── Main section ──────────────────────────────────────────────────────────────

interface ThresholdRulesSectionProps {
    objectId: string;
}

export function ThresholdRulesSection({ objectId }: ThresholdRulesSectionProps) {
    const [rules, setRules]       = useState<ThresholdRule[]>([]);
    const [loading, setLoading]   = useState(true);
    const [error, setError]       = useState<string | null>(null);
    const [showForm, setShowForm] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await listThresholdRules(objectId);
            setRules(data);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load rules");
        } finally {
            setLoading(false);
        }
    }, [objectId]);

    useEffect(() => {
        load();
    }, [load]);

    const handleAdd = useCallback(async (data: Parameters<typeof createThresholdRule>[1]) => {
        const rule = await createThresholdRule(objectId, data);
        setRules((prev) => [...prev, rule]);
        setShowForm(false);
    }, [objectId]);

    const handleToggle = useCallback(async (ruleId: string, enabled: boolean) => {
        const updated = await updateThresholdRule(ruleId, { enabled });
        setRules((prev) => prev.map((r) => r.id === ruleId ? updated : r));
    }, []);

    const handleDelete = useCallback(async (ruleId: string) => {
        await deleteThresholdRule(ruleId);
        setRules((prev) => prev.filter((r) => r.id !== ruleId));
    }, []);

    return (
        <Section
            title="Alert Rules"
            count={rules.length}
            action={
                <button
                    onClick={() => setShowForm((v) => !v)}
                    className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    title="Add alert rule"
                >
                    <Plus className="h-3.5 w-3.5" />
                </button>
            }
        >
            {loading && (
                <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading rules…
                </div>
            )}

            {error && (
                <p className="text-[11px] text-red-500 flex items-center gap-1 py-1">
                    <AlertCircle className="h-3 w-3 shrink-0" /> {error}
                </p>
            )}

            {!loading && !error && rules.length === 0 && !showForm && (
                <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                    <Bell className="h-3.5 w-3.5 shrink-0" />
                    No alert rules. Click + to add one.
                </div>
            )}

            {!loading && rules.map((rule) => (
                <RuleRow
                    key={rule.id}
                    rule={rule}
                    onToggle={(enabled) => handleToggle(rule.id, enabled)}
                    onDelete={() => handleDelete(rule.id)}
                />
            ))}

            {showForm && (
                <AddRuleForm
                    onSave={handleAdd}
                    onCancel={() => setShowForm(false)}
                />
            )}
        </Section>
    );
}
