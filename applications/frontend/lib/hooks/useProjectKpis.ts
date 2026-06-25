"use client";

/**
 * Project KPIs Hook
 * Fetches and evaluates all KPI formulas across all objects in a project.
 * Calls listKpiFormulas + evaluateKpiFormula per object using Promise.allSettled.
 */

import useSWR from "swr";
import {
    listKpiFormulas,
    evaluateKpiFormula,
    type KpiFormula,
} from "../api/kpiFormulas";
import type { GraphObject } from "../api/types";

export interface ProjectKpiResult {
    objectId: string;
    objectName: string;
    objectTypeName: string;
    formula: KpiFormula;
    result: number | null;
    quality: string;
}

async function fetchProjectKpis(objects: GraphObject[]): Promise<ProjectKpiResult[]> {
    // Fetch formulas for all objects in parallel
    const formulaResults = await Promise.allSettled(
        objects.map(async (obj) => {
            const formulas = await listKpiFormulas(obj.id);
            return { obj, formulas };
        })
    );

    // Collect all formulas with their parent context
    const formulasWithContext: Array<{
        obj: GraphObject;
        formula: KpiFormula;
    }> = [];

    for (const result of formulaResults) {
        if (result.status === "fulfilled" && result.value.formulas.length > 0) {
            for (const formula of result.value.formulas) {
                if (formula.enabled) {
                    formulasWithContext.push({ obj: result.value.obj, formula });
                }
            }
        }
    }

    if (formulasWithContext.length === 0) return [];

    // Evaluate all formulas in parallel
    const evalResults = await Promise.allSettled(
        formulasWithContext.map(async ({ obj, formula }) => {
            const evalResult = await evaluateKpiFormula(formula.id);
            return {
                objectId: obj.id,
                objectName: obj.displayName,
                objectTypeName: obj.objectTypeName,
                formula,
                result: evalResult.result,
                quality: evalResult.quality,
            } satisfies ProjectKpiResult;
        })
    );

    return evalResults
        .filter((r): r is PromiseFulfilledResult<ProjectKpiResult> => r.status === "fulfilled")
        .map((r) => r.value);
}

export function useProjectKpis(objects: GraphObject[]) {
    // Stable cache key from sorted object IDs
    const cacheKey =
        objects.length > 0
            ? `project-kpis:${objects.map((o) => o.id).sort().join(",")}`
            : null;

    const { data, error, isLoading } = useSWR<ProjectKpiResult[]>(
        cacheKey,
        () => fetchProjectKpis(objects),
        {
            refreshInterval: 300_000, // 5 min (KPI eval is heavier)
            revalidateOnFocus: false,
            dedupingInterval: 60_000,
        }
    );

    return {
        kpis: data ?? [],
        isLoading,
        isError: error,
    };
}
