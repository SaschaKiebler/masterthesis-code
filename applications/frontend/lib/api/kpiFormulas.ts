import { apiFetch } from "./client";

export type AggregationMode = "LAST" | "SUM" | "AVG" | "MIN" | "MAX";

export interface DirectVariable {
    mode: "DIRECT";
    label: string;
    metricPointId: string;
    aggregation: "LAST";
}

export interface TraverseVariable {
    mode: "TRAVERSE";
    label: string;
    quantityName: string;
    linkTypeName: string;
    direction: "OUTBOUND" | "INBOUND";
    aggregation: Exclude<AggregationMode, "LAST">;
}

export type FormulaVariable = DirectVariable | TraverseVariable;

export interface KpiFormula {
    id: string;
    objectId: string;
    name: string;
    displayName: string;
    formula: string;
    variables: Record<string, FormulaVariable>;
    unit: string | null;
    enabled: boolean;
    tenantId: string;
    createdAt: string;
    updatedAt: string;
}

export interface KpiFormulaEvaluateResult {
    formula: KpiFormula;
    result: number | null;
    quality: string;
}

export async function listKpiFormulas(objectId: string): Promise<KpiFormula[]> {
    const res = await apiFetch<{ formulas: KpiFormula[] }>(
        `/objects/${objectId}/kpi-formulas`
    );
    return res.formulas;
}

export async function createKpiFormula(
    objectId: string,
    data: {
        name: string;
        displayName: string;
        formula: string;
        variables: Record<string, FormulaVariable>;
        unit?: string;
    }
): Promise<KpiFormula> {
    const res = await apiFetch<{ formula: KpiFormula }>(
        `/objects/${objectId}/kpi-formulas`,
        { method: "POST", body: JSON.stringify(data) }
    );
    return res.formula;
}

export async function updateKpiFormula(
    formulaId: string,
    data: Partial<{
        displayName: string;
        formula: string;
        variables: Record<string, FormulaVariable>;
        unit: string;
        enabled: boolean;
    }>
): Promise<KpiFormula> {
    const res = await apiFetch<{ formula: KpiFormula }>(
        `/kpi-formulas/${formulaId}`,
        { method: "PATCH", body: JSON.stringify(data) }
    );
    return res.formula;
}

export async function deleteKpiFormula(formulaId: string): Promise<void> {
    await apiFetch<void>(`/kpi-formulas/${formulaId}`, { method: "DELETE" });
}

export async function evaluateKpiFormula(formulaId: string): Promise<KpiFormulaEvaluateResult> {
    return apiFetch<KpiFormulaEvaluateResult>(
        `/kpi-formulas/${formulaId}/evaluate`,
        { method: "POST" }
    );
}

// ── History (time series) ────────────────────────────────────────────────────

export interface KpiHistoryPoint {
    time: number;
    value: number | null;
    quality: string;
}

export interface KpiHistoryResponse {
    formula: KpiFormula;
    points: KpiHistoryPoint[];
}

export async function getKpiHistory(
    formulaId: string,
    from: number,
    to: number,
): Promise<KpiHistoryResponse> {
    return apiFetch<KpiHistoryResponse>(
        `/kpi-formulas/${formulaId}/history?from=${from}&to=${to}`
    );
}

// ── AI Generation ─────────────────────────────────────────────────────────────

export interface GenerateKpiFormulaRequest {
    prompt: string;
    projectId: string;
}

export interface GenerateKpiFormulaResponse {
    displayName: string;
    name: string;
    formula: string;
    unit: string | null;
    explanation: string;
    confidence: number;
    variables: Record<string, FormulaVariable>;
}

export async function generateKpiFormula(
    objectId: string,
    req: GenerateKpiFormulaRequest
): Promise<GenerateKpiFormulaResponse> {
    return apiFetch<GenerateKpiFormulaResponse>(
        `/objects/${objectId}/kpi-formulas/generate`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(req),
        }
    );
}
