import { apiFetch } from "./client";

export type RuleOperator = "GT" | "LT" | "GTE" | "LTE" | "CHANGED_TO_TRUE" | "CHANGED_TO_FALSE";
export type RuleSeverity = "INFO" | "WARNING" | "ERROR" | "CRITICAL";

export function isStateChangeOperator(op: RuleOperator): boolean {
    return op === "CHANGED_TO_TRUE" || op === "CHANGED_TO_FALSE";
}

export interface ThresholdRule {
    id: string;
    metricPointId: string;
    operator: RuleOperator;
    threshold: number | null;   // null for state-change operators
    severity: RuleSeverity;
    cooldownSeconds: number;
    enabled: boolean;
    tenantId: string;
    createdAt: string;
    updatedAt: string;
}

export async function listThresholdRules(metricPointId: string): Promise<ThresholdRule[]> {
    const res = await apiFetch<{ rules: ThresholdRule[] }>(
        `/metric-points/${metricPointId}/rules`
    );
    return res.rules;
}

export async function createThresholdRule(
    metricPointId: string,
    data: {
        operator: RuleOperator;
        threshold?: number;   // omitted for state-change operators
        severity: RuleSeverity;
        cooldownSeconds: number;
    }
): Promise<ThresholdRule> {
    const res = await apiFetch<{ rule: ThresholdRule }>(
        `/metric-points/${metricPointId}/rules`,
        { method: "POST", body: JSON.stringify(data) }
    );
    return res.rule;
}

export async function updateThresholdRule(
    ruleId: string,
    data: Partial<{
        operator: RuleOperator;
        threshold: number;
        severity: RuleSeverity;
        cooldownSeconds: number;
        enabled: boolean;
    }>
): Promise<ThresholdRule> {
    const res = await apiFetch<{ rule: ThresholdRule }>(
        `/threshold-rules/${ruleId}`,
        { method: "PATCH", body: JSON.stringify(data) }
    );
    return res.rule;
}

export async function deleteThresholdRule(ruleId: string): Promise<void> {
    await apiFetch<void>(`/threshold-rules/${ruleId}`, { method: "DELETE" });
}

export interface DeviceThresholdRule extends ThresholdRule {
    metricPointName: string;
}

export async function listDeviceRules(objectId: string): Promise<DeviceThresholdRule[]> {
    const res = await apiFetch<{ rules: DeviceThresholdRule[] }>(`/objects/${objectId}/rules`);
    return res.rules;
}
