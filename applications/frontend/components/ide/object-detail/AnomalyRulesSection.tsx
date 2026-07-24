"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertCircle, Loader2, Pencil, Plus, Trash2, Wand2 } from "lucide-react";
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
    type ConditionTree,
} from "@/lib/api/anomalyRules";
import { ConditionBuilder } from "../condition-builder/ConditionBuilder";
import { describeRule, parseNumber } from "../condition-builder/graph-model";

const inputCls =
    "w-full min-w-0 max-w-full text-xs h-7 px-2 rounded border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary";
const labelCls = "text-[10px] text-muted-foreground uppercase tracking-wide block mb-1";

const SEVERITY_COLOR: Record<string, string> = {
    INFO: "text-sky-500",
    WARNING: "text-amber-500",
    ERROR: "text-orange-500",
    CRITICAL: "text-red-500",
};

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
    const [builderOpen, setBuilderOpen] = useState(false);
    const [builderRule, setBuilderRule] = useState<AnomalyRule | null>(null);

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

    const openBuilder = useCallback((rule: AnomalyRule | null) => {
        setBuilderRule(rule);
        setBuilderOpen(true);
        setShowForm(false);
    }, []);

    const handleBuilderSave = useCallback(async (input: AnomalyRuleInput) => {
        if (builderRule) {
            await updateAnomalyRule(builderRule.id, input);
        } else {
            await createAnomalyRule(input);
        }
        setBuilderOpen(false);
        setBuilderRule(null);
        await load();
    }, [builderRule, load]);

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
                <RuleRow
                    key={rule.id}
                    rule={rule}
                    channels={channels}
                    templateLabel={templateLabel(rule.detector)}
                    onToggle={(enabled) => handleToggle(rule.id, enabled)}
                    onEdit={rule.detector === "condition" ? () => openBuilder(rule) : undefined}
                    onDelete={() => handleDelete(rule.id)}
                />
            ))}

            {showForm && !loading && (
                <AnomalyRuleForm
                    templates={templates}
                    channels={channels}
                    onSave={handleAdd}
                    onOpenBuilder={() => openBuilder(null)}
                    onCancel={() => setShowForm(false)}
                />
            )}

            <ConditionBuilder
                open={builderOpen}
                channels={channels}
                currentAssetId={objectId}
                initialRule={builderRule}
                onSave={handleBuilderSave}
                onClose={() => { setBuilderOpen(false); setBuilderRule(null); }}
            />
        </Section>
    );
}

// ── Rule row ──────────────────────────────────────────────────────────────────

function RuleRow({
    rule,
    channels,
    templateLabel,
    onToggle,
    onEdit,
    onDelete,
}: {
    rule: AnomalyRule;
    channels: ChannelOption[];
    templateLabel: string;
    onToggle: (enabled: boolean) => void;
    onEdit?: () => void;
    onDelete: () => void;
}) {
    const description = useMemo(() => {
        if (rule.detector !== "condition") return null;
        return describeRule(
            rule.params?.condition as ConditionTree | undefined,
            rule.bindings,
            channels
        );
    }, [rule, channels]);

    return (
        <div className="flex items-center gap-2 py-1.5 border-b border-border/50 last:border-0">
            <div className="flex-1 min-w-0">
                <p className="text-xs text-foreground truncate">{rule.name}</p>
                <p className="text-[10px] text-muted-foreground truncate" title={description ?? undefined}>
                    {templateLabel}
                    {" · "}
                    <span className={SEVERITY_COLOR[rule.severity] ?? ""}>{rule.severity}</span>
                    {description ? ` · ${description}` : ""}
                </p>
            </div>
            {onEdit && (
                <button
                    onClick={onEdit}
                    className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
                    title="Edit in condition builder"
                >
                    <Pencil className="h-3.5 w-3.5" />
                </button>
            )}
            <button
                type="button"
                role="switch"
                aria-checked={rule.enabled}
                onClick={() => onToggle(!rule.enabled)}
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
                onClick={onDelete}
                className="p-0.5 rounded text-muted-foreground hover:text-red-500 hover:bg-muted transition-colors shrink-0"
                title="Delete rule"
            >
                <Trash2 className="h-3.5 w-3.5" />
            </button>
        </div>
    );
}

// ── Add form (templates; custom conditions go to the builder) ────────────────

interface AnomalyRuleFormProps {
    templates: AnomalyRuleTemplate[];
    channels: ChannelOption[];
    onSave: (input: AnomalyRuleInput) => Promise<void>;
    onOpenBuilder: () => void;
    onCancel: () => void;
}

function AnomalyRuleForm({ templates, channels, onSave, onOpenBuilder, onCancel }: AnomalyRuleFormProps) {
    const [name, setName] = useState("");
    const [templateKey, setTemplateKey] = useState(templates[0]?.key ?? "");
    const [roleBindings, setRoleBindings] = useState<Record<string, string>>({});
    const [suppressId, setSuppressId] = useState("");
    const [paramDrafts, setParamDrafts] = useState<Record<string, string>>({});
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
    }, [template, name, cooldown, roleBindings, paramDrafts, suppressId, severity]);

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
        <div className="mt-2 p-3 rounded-lg bg-muted/50 border border-border space-y-2 min-w-0 overflow-hidden">
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

            {template?.dynamicRoles ? (
                // Custom conditions are built in the full-screen graphical builder.
                <button
                    onClick={onOpenBuilder}
                    className="w-full flex items-center justify-center gap-1.5 text-xs px-2.5 py-2 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                    <Wand2 className="h-3.5 w-3.5" />
                    Open condition builder
                </button>
            ) : (
                <>
                    <div>
                        <label className={labelCls}>Name</label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g. Short cycling boiler"
                            className={inputCls}
                        />
                    </div>

                    {template?.roles.map((role) => (
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
                    {template && template.params.length > 0 && (
                        <div className="grid grid-cols-2 gap-2">
                            {template.params.map((param) => (
                                <div key={param.key} className="min-w-0">
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
                        <div className="min-w-0">
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
                        <div className="min-w-0">
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
                </>
            )}

            {error && (
                <p className="text-[11px] text-red-500 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3 shrink-0" /> {error}
                </p>
            )}

            <div className="flex gap-2 pt-1">
                {!template?.dynamicRoles && (
                    <button
                        onClick={handleSubmit}
                        disabled={saving}
                        className="flex items-center gap-1 text-xs px-2.5 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                    >
                        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                        Add Rule
                    </button>
                )}
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
