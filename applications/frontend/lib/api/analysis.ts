/**
 * Analysis Canvas API — CRUD for analysis views and templates.
 */

import { apiFetch } from "./client";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AnalysisView {
    id: string;
    projectId: string;
    name: string;
    definition: string; // JSON string of CanvasDefinition
    createdAt: string;
    updatedAt: string;
}

export interface AnalysisTemplate {
    id: string;
    tenantId: string | null;
    name: string;
    description: string | null;
    category: string | null;
    isSystem: boolean;
    definition: string;
    createdAt: string;
    updatedAt: string;
}

export interface ListAnalysisViewsResponse {
    analysisViews: AnalysisView[];
}

export interface GetAnalysisViewResponse {
    analysisView: AnalysisView;
}

export interface ListAnalysisTemplatesResponse {
    analysisTemplates: AnalysisTemplate[];
}

export interface GetAnalysisTemplateResponse {
    analysisTemplate: AnalysisTemplate;
}

// ─── Canvas Definition Schema ───────────────────────────────────────────────

export interface CanvasDefinition {
    version: 1;
    timeRange?: { preset: string; customFrom?: number; customTo?: number };
    bucketMinutes?: number | null;
    charts: ChartDefinition[];
}

export interface ChartDefinition {
    id: string;
    title: string;
    type: ChartType;
    position: { order: number; height: number };
    sources: ChartSource[];
    calculations: ChartCalculation[];
    display: ChartDisplay;
}

export type ChartType = "time_series" | "scatter" | "boxplot" | "heatmap" | "histogram" | "table";

export interface ChartSource {
    id: string;
    label: string;
    color: string;
    metricPointId?: string;
    binding?: {
        quantityName: string;
        objectType?: string;
        required: boolean;
    };
    yAxisIndex: number;
    valueTransform?: {
        multiply?: number;
        offset?: number;
        unit?: string;
    };
}

export interface ChartCalculation {
    id: string;
    type: CalculationType;
    label: string;
    color: string;
    inputs: Record<string, string>;
    params?: Record<string, unknown>;
    showAs: "line" | "area" | "markers" | "band";
    yAxisIndex?: number;
}

export type CalculationType =
    | "mean"
    | "median"
    | "moving_average"
    | "min_max_band"
    | "std_band"
    | "percentile_band"
    | "outliers"
    | "trend"
    | "reference_line"
    | "difference"
    | "ratio"
    | "sum"
    | "formula"
    | "regression"
    | "correlation";

export interface ChartDisplay {
    yAxes: { unit: string; position: "left" | "right"; label?: string }[];
    showLegend: boolean;
    showDataZoom: boolean;
    xSource?: string;
    ySource?: string;
    groupBy?: "hour" | "weekday" | "month" | "outdoor_temp_bin";
    xGroupBy?: string;
    yGroupBy?: string;
    aggregation?: string;
}

// ─── API Functions: Analysis Views ──────────────────────────────────────────

export async function listAnalysisViews(projectId: string): Promise<ListAnalysisViewsResponse> {
    return apiFetch<ListAnalysisViewsResponse>(`/projects/${projectId}/analysis-views`);
}

export async function getAnalysisView(viewId: string): Promise<GetAnalysisViewResponse> {
    return apiFetch<GetAnalysisViewResponse>(`/analysis-views/${viewId}`);
}

export async function createAnalysisView(
    projectId: string,
    data: { name: string; definition?: CanvasDefinition }
): Promise<GetAnalysisViewResponse> {
    return apiFetch<GetAnalysisViewResponse>(`/projects/${projectId}/analysis-views`, {
        method: "POST",
        body: JSON.stringify({
            name: data.name,
            definition: data.definition ? data.definition : undefined,
        }),
    });
}

export async function updateAnalysisView(
    viewId: string,
    data: { name?: string; definition?: CanvasDefinition }
): Promise<GetAnalysisViewResponse> {
    return apiFetch<GetAnalysisViewResponse>(`/analysis-views/${viewId}`, {
        method: "PATCH",
        body: JSON.stringify({
            name: data.name,
            definition: data.definition ? data.definition : undefined,
        }),
    });
}

export async function deleteAnalysisView(viewId: string): Promise<void> {
    await apiFetch(`/analysis-views/${viewId}`, { method: "DELETE" });
}

// ─── API Functions: Analysis Templates ──────────────────────────────────────

export async function listAnalysisTemplates(
    tenantId?: string
): Promise<ListAnalysisTemplatesResponse> {
    const qs = tenantId ? `?tenantId=${tenantId}` : "";
    return apiFetch<ListAnalysisTemplatesResponse>(`/analysis-templates${qs}`);
}

export async function getAnalysisTemplate(templateId: string): Promise<GetAnalysisTemplateResponse> {
    return apiFetch<GetAnalysisTemplateResponse>(`/analysis-templates/${templateId}`);
}

export async function createAnalysisTemplate(data: {
    name: string;
    description?: string;
    category?: string;
    tenantId?: string;
    definition?: CanvasDefinition;
}): Promise<GetAnalysisTemplateResponse> {
    return apiFetch<GetAnalysisTemplateResponse>("/analysis-templates", {
        method: "POST",
        body: JSON.stringify({
            ...data,
            definition: data.definition ? data.definition : undefined,
        }),
    });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export const CHART_COLORS = [
    "#ef4444", "#3b82f6", "#f59e0b", "#10b981", "#8b5cf6",
    "#ec4899", "#06b6d4", "#f97316", "#6366f1", "#14b8a6",
    "#e11d48", "#2563eb", "#ca8a04", "#059669", "#7c3aed",
];

export function getChartColor(index: number): string {
    return CHART_COLORS[index % CHART_COLORS.length];
}

// Formula calculations: sources are bound to single-letter variables (a, b, c, …)
// and referenced in an expression like "(a - b) * 1.163".
export const FORMULA_FUNCTIONS = ["abs", "sqrt", "log", "exp", "round", "min", "max"] as const;

const VARIABLE_LETTERS = "abcdefghijklmnopqrstuvwxyz";

export function buildFormulaVariableMap(sources: ChartSource[]): Record<string, string> {
    const map: Record<string, string> = {};
    sources.slice(0, VARIABLE_LETTERS.length).forEach((src, i) => {
        map[VARIABLE_LETTERS[i]] = src.id;
    });
    return map;
}

export function createEmptyCanvas(): CanvasDefinition {
    return { version: 1, charts: [] };
}

export function createEmptyChart(id: string, order: number): ChartDefinition {
    return {
        id,
        title: "New Chart",
        type: "time_series",
        position: { order, height: 400 },
        sources: [],
        calculations: [],
        display: {
            yAxes: [{ unit: "°C", position: "left" }],
            showLegend: true,
            showDataZoom: true,
        },
    };
}
