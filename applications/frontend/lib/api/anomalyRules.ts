import { apiFetch } from "./client";
import type { RuleSeverity } from "./thresholdRules";

// ── Template descriptors (served by core, single source for the editor) ──────

export interface TemplateRole {
    role: string;
    required: boolean;
    label: string;
}

export interface TemplateParam {
    key: string;
    defaultValue: number;
    label: string;
}

export interface AnomalyRuleTemplate {
    key: string;
    label: string;
    description: string;
    dynamicRoles: boolean;
    roles: TemplateRole[];
    params: TemplateParam[];
    suppressRole: string;
}

// ── Rules ────────────────────────────────────────────────────────────────────

export interface ChannelBinding {
    role: string;
    metricPointId: string;
}

export type ConditionAggregate =
    | "mean" | "min" | "max" | "last" | "duty" | "edges_per_hour" | "t_out";
export type ConditionOperator = "GT" | "LT" | "GTE" | "LTE";

export interface ConditionLeaf {
    agg: ConditionAggregate;
    role?: string;        // absent for t_out
    window_s?: number;    // absent for t_out
    op: ConditionOperator;
    value: number;
}

export interface ConditionTree {
    all?: (ConditionLeaf | ConditionTree)[];
    any?: (ConditionLeaf | ConditionTree)[];
}

export interface AnomalyRule {
    id: string;
    tenantId: string;
    name: string;
    detector: string;
    params: Record<string, unknown>;
    bindings: ChannelBinding[];
    severity: RuleSeverity;
    cooldownSeconds: number;
    enabled: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface AnomalyRuleInput {
    name: string;
    detector: string;
    params: Record<string, unknown>;
    bindings: ChannelBinding[];
    severity: RuleSeverity;
    cooldownSeconds: number;
}

// ── Channel catalog (binding pickers) ────────────────────────────────────────

export interface ChannelOption {
    metricPointId: string;
    deviceId: string;
    metricId: number;
    unit: string | null;
    metricName: string;
    assetId: string | null;
    assetName: string | null;
}

// ── API calls ────────────────────────────────────────────────────────────────

export async function listAnomalyRuleTemplates(): Promise<AnomalyRuleTemplate[]> {
    const res = await apiFetch<{ templates: AnomalyRuleTemplate[] }>("/anomaly-rule-templates");
    return res.templates;
}

export async function listChannelOptions(): Promise<ChannelOption[]> {
    const res = await apiFetch<{ channels: ChannelOption[] }>("/channels");
    return res.channels;
}

export async function listObjectAnomalyRules(objectId: string): Promise<AnomalyRule[]> {
    const res = await apiFetch<{ rules: AnomalyRule[] }>(`/objects/${objectId}/anomaly-rules`);
    return res.rules;
}

export async function createAnomalyRule(input: AnomalyRuleInput): Promise<AnomalyRule> {
    const res = await apiFetch<{ rule: AnomalyRule }>("/anomaly-rules", {
        method: "POST",
        body: JSON.stringify(input),
    });
    return res.rule;
}

export async function updateAnomalyRule(
    ruleId: string,
    data: Partial<AnomalyRuleInput & { enabled: boolean }>
): Promise<AnomalyRule> {
    const res = await apiFetch<{ rule: AnomalyRule }>(`/anomaly-rules/${ruleId}`, {
        method: "PATCH",
        body: JSON.stringify(data),
    });
    return res.rule;
}

export async function deleteAnomalyRule(ruleId: string): Promise<void> {
    await apiFetch<void>(`/anomaly-rules/${ruleId}`, { method: "DELETE" });
}
