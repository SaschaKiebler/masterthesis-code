"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertCircle, Loader2, Plus, Trash2 } from "lucide-react";
import { Section } from "./Section";
import type { RuleSeverity } from "@/lib/api/thresholdRules";
import {
    createAnomalyRule,
    deleteAnomalyRule,
    listAnomalyRuleTemplates,
    listChannelOptions,
    listObjectAnomalyRules,
    updateAnomalyRule,
    type AnomalyRule,
    type AnomalyRuleInput,
    type AnomalyRuleTemplate,
    type ChannelBinding,
    type ChannelOption,
    type ConditionAggregate,
    type ConditionLeaf,
    type ConditionOperator,
} from "@/lib/api/anomalyRules";

const inputCls =
    "w-full text-xs h-7 px-2 rounded border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary";
const labelCls = "text-[10px] text-muted-foreground uppercase tracking-wide block mb-1";

const SEVERITY_COLOR: Record<string, string> = {
    INFO: "text-sky-500",
    WARNING: "text-amber-500",
    ERROR: "text-orange-500",
    CRITICAL: "text-red-500",
};

/** Parse a user-typed number, accepting both "." and "," as separator. */
function parseNumber(raw: string): number {
    return parseFloat(raw.trim().replace(",", "."));
}

function channelLabel(channel: ChannelOption): string {
    const asset = channel.assetName ?? channel.deviceId;
    const unit = channel.unit ? ` (${channel.unit})` : "";
    return `${asset} · ${channel.metricName}${unit}`;
}

// ── Main section ──────────────────────────────────────────────────────────────

interface AnomalyRulesSectionProps {
    objectId: string;
}

export function AnomalyRulesSection({ objectId }: AnomalyRulesSectionProps) {
    const [rules, setRules] = useState<AnomalyRule[]>([]);
    const [templates, setTemplates] = useState<AnomalyRuleTemplate[]>([]);
    const [channels, setChannels] = useState<ChannelOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showForm, setShowForm] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [rulesData, templateData, channelData] = await Promise.all([
                listObjectAnomalyRules(objectId),
                listAnomalyRuleTemplates(),
                listChannelOptions(),
            ]);
            setRules(rulesData);
            setTemplates(templateData);
            setChannels(channelData);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load anomaly rules");
        } finally {
            setLoading(false);
        }
    }, [objectId]);

    useEffect(() => { load(); }, [load]);

    const templateLabel = useCallback(
        (key: string) => templates.find((t) => t.key === key)?.label ?? key,
        [templates]
    );

    const handleAdd = useCallback(async (input: AnomalyRuleInput) => {
        await createAnomalyRule(input);
        setShowForm(false);
        await load();
    }, [load]);

    const handleToggle = useCallback(async (ruleId: string, enabled: boolean) => {
        const updated = await updateAnomalyRule(ruleId, { enabled });
        setRules((prev) => prev.map((r) => (r.id === ruleId ? updated : r)));
    }, []);

    const handleDelete = useCallback(async (ruleId: string) => {
        await deleteAnomalyRule(ruleId);
        setRules((prev) => prev.filter((r) => r.id !== ruleId));
    }, []);

    return (
        <Section
            title="Anomaly Rules"
            count={rules.length}
            tooltip="Detector template instances bound to this asset's channels — cycling, weather context, missing demand coupling, or custom conditions."
            action={
                <button
                    onClick={() => setShowForm((v) => !v)}
                    className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    title="Add anomaly rule"
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
                    <Activity className="h-3.5 w-3.5 shrink-0" />
                    No anomaly rules yet. Click + to add one.
                </div>
            )}

            {!loading && rules.map((rule) => (
                <div key={rule.id} className="flex items-center gap-2 py-1.5 border-b border-border/50 last:border-0">
                    <div className="flex-1 min-w-0">
                        <p className="text-xs text-foreground truncate">{rule.name}</p>
                        <p className="text-[10px] text-muted-foreground">
                            {templateLabel(rule.detector)}
                            {" · "}
                            <span className={SEVERITY_COLOR[rule.severity] ?? ""}>{rule.severity}</span>
                        </p>
                    </div>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={rule.enabled}
                        onClick={() => handleToggle(rule.id, !rule.enabled)}
                        className={`relative w-8 h-4.5 rounded-full transition-colors shrink-0 ${
                            rule.enabled ? "bg-primary" : "bg-border"
                        }`}
                        title={rule.enabled ? "Disable rule" : "Enable rule"}
                    >
                        <span className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full bg-white transition-transform ${
                            rule.enabled ? "translate-x-3.5" : ""
                        }`} />
                    </button>
                    <button
                        onClick={() => handleDelete(rule.id)}
                        className="p-0.5 rounded text-muted-foreground hover:text-red-500 hover:bg-muted transition-colors shrink-0"
                        title="Delete rule"
                    >
                        <Trash2 className="h-3.5 w-3.5" />
                    </button>
                </div>
            ))}

            {showForm && !loading && (
                <AnomalyRuleForm
                    templates={templates}
                    channels={channels}
                    onSave={handleAdd}
                    onCancel={() => setShowForm(false)}
                />
            )}
        </Section>
    );
}

// ── Add form ──────────────────────────────────────────────────────────────────

interface ConditionRow {
    agg: ConditionAggregate;
    metricPointId: string;
    windowMin: string;
    op: ConditionOperator;
    value: string;
}

interface AnomalyRuleFormProps {
    templates: AnomalyRuleTemplate[];
    channels: ChannelOption[];
    onSave: (input: AnomalyRuleInput) => Promise<void>;
    onCancel: () => void;
}

function AnomalyRuleForm({ templates, channels, onSave, onCancel }: AnomalyRuleFormProps) {
    const [name, setName] = useState("");
    const [templateKey, setTemplateKey] = useState(templates[0]?.key ?? "");
    const [roleBindings, setRoleBindings] = useState<Record<string, string>>({});
    const [suppressId, setSuppressId] = useState("");
    const [paramDrafts, setParamDrafts] = useState<Record<string, string>>({});
    const [combine, setCombine] = useState<"all" | "any">("all");
    const [conditionRows, setConditionRows] = useState<ConditionRow[]>([
        { agg: "duty", metricPointId: "", windowMin: "30", op: "GT", value: "0.9" },
    ]);
    const [severity, setSeverity] = useState<RuleSeverity>("WARNING");
    const [cooldown, setCooldown] = useState("1800");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const template = useMemo(
        () => templates.find((t) => t.key === templateKey),
        [templates, templateKey]
    );

    const handleTemplateChange = useCallback((key: string) => {
        setTemplateKey(key);
        setRoleBindings({});
        setParamDrafts({});
        setError(null);
    }, []);

    const buildPayload = useCallback((): AnomalyRuleInput => {
        if (!template) throw new Error("Select a template");
        if (!name.trim()) throw new Error("Name is required");
        const cooldownSec = parseInt(cooldown, 10);
        if (isNaN(cooldownSec) || cooldownSec < 0) throw new Error("Cooldown must be ≥ 0");

        const bindings: ChannelBinding[] = [];
        const params: Record<string, unknown> = {};

        if (!template.dynamicRoles) {
            for (const role of template.roles) {
                const metricPointId = roleBindings[role.role] ?? "";
                if (!metricPointId) {
                    if (role.required) throw new Error(`Bind the '${role.label}' channel`);
                    continue;
                }
                bindings.push({ role: role.role, metricPointId });
            }
            for (const param of template.params) {
                const draft = paramDrafts[param.key];
                if (draft === undefined || draft.trim() === "") {
                    params[param.key] = param.defaultValue;
                    continue;
                }
                const parsed = parseNumber(draft);
                if (isNaN(parsed)) throw new Error(`'${param.label}' must be a number`);
                params[param.key] = parsed;
            }
        } else {
            // Condition builder: one role per distinct channel, leaves reference roles.
            const roleByChannel = new Map<string, string>();
            const leaves: ConditionLeaf[] = [];
            for (const row of conditionRows) {
                const value = parseNumber(row.value);
                if (isNaN(value)) throw new Error("Every condition needs a numeric value");
                if (row.agg === "t_out") {
                    leaves.push({ agg: "t_out", op: row.op, value });
                    continue;
                }
                if (!row.metricPointId) throw new Error("Every condition needs a channel");
                const windowMin = parseNumber(row.windowMin);
                if (isNaN(windowMin) || windowMin <= 0) {
                    throw new Error("Every condition needs a positive window");
                }
                let role = roleByChannel.get(row.metricPointId);
                if (!role) {
                    role = `c${roleByChannel.size + 1}`;
                    roleByChannel.set(row.metricPointId, role);
                    bindings.push({ role, metricPointId: row.metricPointId });
                }
                leaves.push({ agg: row.agg, role, window_s: Math.round(windowMin * 60), op: row.op, value });
            }
            if (leaves.length === 0) throw new Error("Add at least one condition");
            if (bindings.length === 0) {
                throw new Error("At least one condition must reference a channel");
            }
            params.condition = { [combine]: leaves };
        }

        if (suppressId) {
            bindings.push({ role: template.suppressRole, metricPointId: suppressId });
        }
        return {
            name: name.trim(),
            detector: template.key,
            params,
            bindings,
            severity,
            cooldownSeconds: cooldownSec,
        };
    }, [template, name, cooldown, roleBindings, paramDrafts, conditionRows, combine, suppressId, severity]);

    const handleSubmit = useCallback(async () => {
        setError(null);
        let payload: AnomalyRuleInput;
        try {
            payload = buildPayload();
        } catch (e) {
            setError(e instanceof Error ? e.message : "Invalid rule");
            return;
        }
        setSaving(true);
        try {
            await onSave(payload);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to create rule");
        } finally {
            setSaving(false);
        }
    }, [buildPayload, onSave]);

    if (channels.length === 0) {
        return (
            <div className="mt-2 p-3 rounded-lg bg-muted/50 border border-border text-xs text-muted-foreground">
                No channels available yet. Commission a device with a signal map first.
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
            <div>
                <label className={labelCls}>Name</label>
                <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Distribution pump without demand"
                    className={inputCls}
                />
            </div>

            <div>
                <label className={labelCls}>Template</label>
                <select
                    value={templateKey}
                    onChange={(e) => handleTemplateChange(e.target.value)}
                    className={inputCls}
                >
                    {templates.map((t) => (
                        <option key={t.key} value={t.key}>{t.label}</option>
                    ))}
                </select>
                {template && (
                    <p className="text-[10px] text-muted-foreground mt-1">{template.description}</p>
                )}
            </div>

            {template && !template.dynamicRoles && (
                <>
                    {template.roles.map((role) => (
                        <div key={role.role}>
                            <label className={labelCls}>
                                {role.label}{role.required ? "" : " (optional)"}
                            </label>
                            <ChannelSelect
                                channels={channels}
                                value={roleBindings[role.role] ?? ""}
                                allowEmpty={!role.required}
                                onChange={(id) => setRoleBindings((prev) => ({ ...prev, [role.role]: id }))}
                            />
                        </div>
                    ))}
                    {template.params.length > 0 && (
                        <div className="grid grid-cols-2 gap-2">
                            {template.params.map((param) => (
                                <div key={param.key}>
                                    <label className={labelCls}>{param.label}</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={paramDrafts[param.key] ?? ""}
                                        placeholder={String(param.defaultValue)}
                                        onChange={(e) => setParamDrafts((prev) => ({
                                            ...prev, [param.key]: e.target.value,
                                        }))}
                                        className={inputCls}
                                    />
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}

            {template?.dynamicRoles && (
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                        <label className={`${labelCls} mb-0`}>Conditions</label>
                        <div className="flex gap-1">
                            {(["all", "any"] as const).map((mode) => (
                                <button
                                    key={mode}
                                    onClick={() => setCombine(mode)}
                                    className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded transition-colors ${
                                        combine === mode
                                            ? "bg-primary text-primary-foreground"
                                            : "bg-muted text-muted-foreground hover:text-foreground"
                                    }`}
                                >
                                    {mode === "all" ? "AND" : "OR"}
                                </button>
                            ))}
                        </div>
                    </div>
                    {conditionRows.map((row, index) => (
                        <ConditionRowEditor
                            key={index}
                            row={row}
                            channels={channels}
                            onChange={(next) => setConditionRows((prev) =>
                                prev.map((r, i) => (i === index ? next : r)))}
                            onRemove={conditionRows.length > 1
                                ? () => setConditionRows((prev) => prev.filter((_, i) => i !== index))
                                : undefined}
                        />
                    ))}
                    <button
                        onClick={() => setConditionRows((prev) => [
                            ...prev,
                            { agg: "duty", metricPointId: "", windowMin: "30", op: "GT", value: "0.5" },
                        ])}
                        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <Plus className="h-3 w-3" /> Add condition
                    </button>
                </div>
            )}

            <div>
                <label className={labelCls}>Suppress while active (optional)</label>
                <ChannelSelect
                    channels={channels}
                    value={suppressId}
                    allowEmpty
                    onChange={setSuppressId}
                />
            </div>

            <div className="grid grid-cols-2 gap-2">
                <div>
                    <label className={labelCls}>Severity</label>
                    <select
                        value={severity}
                        onChange={(e) => setSeverity(e.target.value as RuleSeverity)}
                        className={inputCls}
                    >
                        <option value="INFO">Info</option>
                        <option value="WARNING">Warning</option>
                        <option value="ERROR">Error</option>
                        <option value="CRITICAL">Critical</option>
                    </select>
                </div>
                <div>
                    <label className={labelCls}>Cooldown (sec)</label>
                    <input
                        type="text"
                        inputMode="numeric"
                        value={cooldown}
                        onChange={(e) => setCooldown(e.target.value)}
                        className={inputCls}
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

// ── Pieces ────────────────────────────────────────────────────────────────────

function ChannelSelect({
    channels,
    value,
    onChange,
    allowEmpty = false,
}: {
    channels: ChannelOption[];
    value: string;
    onChange: (metricPointId: string) => void;
    allowEmpty?: boolean;
}) {
    return (
        <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={inputCls}
        >
            <option value="">{allowEmpty ? "—" : "Select channel…"}</option>
            {channels.map((channel) => (
                <option key={channel.metricPointId} value={channel.metricPointId}>
                    {channelLabel(channel)}
                </option>
            ))}
        </select>
    );
}

const AGGREGATES: { key: ConditionAggregate; label: string }[] = [
    { key: "duty", label: "duty cycle" },
    { key: "mean", label: "mean" },
    { key: "min", label: "min" },
    { key: "max", label: "max" },
    { key: "last", label: "last value" },
    { key: "edges_per_hour", label: "starts/h" },
    { key: "t_out", label: "outdoor °C" },
];

function ConditionRowEditor({
    row,
    channels,
    onChange,
    onRemove,
}: {
    row: ConditionRow;
    channels: ChannelOption[];
    onChange: (row: ConditionRow) => void;
    onRemove?: () => void;
}) {
    const isWeather = row.agg === "t_out";
    return (
        <div className="p-2 rounded border border-border bg-background/60 space-y-1.5">
            <div className="flex items-center gap-1.5">
                <select
                    value={row.agg}
                    onChange={(e) => onChange({ ...row, agg: e.target.value as ConditionAggregate })}
                    className={`${inputCls} flex-1`}
                >
                    {AGGREGATES.map((agg) => (
                        <option key={agg.key} value={agg.key}>{agg.label}</option>
                    ))}
                </select>
                <select
                    value={row.op}
                    onChange={(e) => onChange({ ...row, op: e.target.value as ConditionOperator })}
                    className={`${inputCls} w-14 shrink-0`}
                >
                    <option value="GT">{">"}</option>
                    <option value="LT">{"<"}</option>
                    <option value="GTE">≥</option>
                    <option value="LTE">≤</option>
                </select>
                <input
                    type="text"
                    inputMode="decimal"
                    value={row.value}
                    onChange={(e) => onChange({ ...row, value: e.target.value })}
                    className={`${inputCls} w-16 shrink-0 text-right`}
                />
                {onRemove && (
                    <button
                        onClick={onRemove}
                        className="p-0.5 rounded text-muted-foreground hover:text-red-500 transition-colors shrink-0"
                        title="Remove condition"
                    >
                        <Trash2 className="h-3 w-3" />
                    </button>
                )}
            </div>
            {!isWeather && (
                <div className="flex items-center gap-1.5">
                    <div className="flex-1">
                        <ChannelSelect
                            channels={channels}
                            value={row.metricPointId}
                            onChange={(id) => onChange({ ...row, metricPointId: id })}
                        />
                    </div>
                    <input
                        type="text"
                        inputMode="decimal"
                        value={row.windowMin}
                        onChange={(e) => onChange({ ...row, windowMin: e.target.value })}
                        className={`${inputCls} w-16 shrink-0 text-right`}
                        title="Window (minutes)"
                    />
                    <span className="text-[10px] text-muted-foreground shrink-0">min</span>
                </div>
            )}
        </div>
    );
}
