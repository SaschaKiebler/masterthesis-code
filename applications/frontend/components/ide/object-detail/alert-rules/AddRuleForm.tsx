"use client";

import { useState, useCallback } from "react";
import { AlertCircle, Loader2, ToggleLeft } from "lucide-react";
import { type RuleOperator, type RuleSeverity } from "@/lib/api/thresholdRules";
import { type DeviceMetricPoint } from "@/lib/api/graph";

// ── Add rule form ─────────────────────────────────────────────────────────────

export type RuleMode = "threshold" | "state_change";

export interface AddRuleFormProps {
    metricPoints: DeviceMetricPoint[];
    onSave: (metricPointId: string, data: {
        operator: RuleOperator;
        threshold?: number;
        severity: RuleSeverity;
        cooldownSeconds: number;
    }) => Promise<void>;
    onCancel: () => void;
}

export function AddRuleForm({ metricPoints, onSave, onCancel }: AddRuleFormProps) {
    const [metricPointId, setMetricPointId] = useState(metricPoints[0]?.id ?? "");
    const [mode, setMode]           = useState<RuleMode>("threshold");
    const [operator, setOperator]   = useState<RuleOperator>("GT");
    const [stateOp, setStateOp]     = useState<RuleOperator>("CHANGED_TO_TRUE");
    const [threshold, setThreshold] = useState("");
    const [severity, setSeverity]   = useState<RuleSeverity>("WARNING");
    const [cooldown, setCooldown]   = useState("300");
    const [saving, setSaving]       = useState(false);
    const [error, setError]         = useState<string | null>(null);

    const handleModeChange = useCallback((next: RuleMode) => {
        setMode(next);
        setCooldown(next === "state_change" ? "0" : "300");
    }, []);

    const handleSubmit = useCallback(async () => {
        if (!metricPointId) { setError("Select a metric"); return; }
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
            await onSave(metricPointId, {
                operator: finalOperator,
                threshold: finalThreshold,
                severity,
                cooldownSeconds: cooldownSec,
            });
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to create rule");
        } finally {
            setSaving(false);
        }
    }, [metricPointId, mode, operator, stateOp, threshold, severity, cooldown, onSave]);

    if (metricPoints.length === 0) {
        return (
            <div className="mt-2 p-3 rounded-lg bg-muted/50 border border-border text-xs text-muted-foreground">
                Save a signal map first to create alert rules.
                <div className="flex gap-2 pt-2">
                    <button onClick={onCancel} className="text-xs px-2.5 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                        Close
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="mt-2 p-3 rounded-lg bg-muted/50 border border-border space-y-2">
            {/* Metric selector */}
            <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wide block mb-1">
                    Metric
                </label>
                <select
                    value={metricPointId}
                    onChange={(e) => setMetricPointId(e.target.value)}
                    className="w-full text-xs h-7 px-2 rounded border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                    {metricPoints.map((mp) => (
                        <option key={mp.id} value={mp.id}>
                            {mp.displayName ?? `Metric ${mp.metricId}`}
                            {mp.unit ? ` (${mp.unit})` : ""}
                        </option>
                    ))}
                </select>
            </div>

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
