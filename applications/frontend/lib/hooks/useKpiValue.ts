"use client";

import useSWR from "swr";
import { evaluateKpiFormula } from "../api/kpiFormulas";

/**
 * Evaluates a single KPI formula and returns its current value.
 * Re-evaluates every 30 seconds.
 */
export function useKpiValue(formulaId: string | null) {
    const { data, error, isLoading } = useSWR(
        formulaId ? `kpi-value:${formulaId}` : null,
        () => evaluateKpiFormula(formulaId!),
        {
            refreshInterval: 30_000,
            revalidateOnFocus: false,
            dedupingInterval: 10_000,
        }
    );

    return {
        value: data?.result ?? null,
        unit: data?.formula?.unit ?? null,
        quality: data?.quality ?? null,
        isLoading,
        isError: !!error,
    };
}
