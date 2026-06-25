"use client";

import type { RuleOperator, RuleSeverity } from "@/lib/api/thresholdRules";

// Re-export for convenience
export type { RuleOperator, RuleSeverity };

// ── Helpers ───────────────────────────────────────────────────────────────────

export const OPERATOR_LABELS: Record<RuleOperator, string> = {
    GT:               ">",
    LT:               "<",
    GTE:              "≥",
    LTE:              "≤",
    CHANGED_TO_TRUE:  "→ ON",
    CHANGED_TO_FALSE: "→ OFF",
};

export const SEVERITY_STYLES: Record<RuleSeverity, string> = {
    INFO:     "bg-blue-500/10 text-blue-500 border border-blue-500/20",
    WARNING:  "bg-amber-500/10 text-amber-500 border border-amber-500/20",
    ERROR:    "bg-orange-500/10 text-orange-500 border border-orange-500/20",
    CRITICAL: "bg-red-500/10 text-red-600 border border-red-500/20",
};

export function formatCooldown(seconds: number): string {
    if (seconds === 0)  return "no cooldown";
    if (seconds < 60)   return `${seconds}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    return `${Math.round(seconds / 3600)}h`;
}
