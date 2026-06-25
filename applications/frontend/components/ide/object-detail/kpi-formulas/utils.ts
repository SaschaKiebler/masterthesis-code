"use client";

// ── Constants ─────────────────────────────────────────────────────────────────

export const LINK_TYPE_OPTIONS = [
    "ANY", "FEEDS", "CONTAINS", "SERVES", "INSTALLED_IN", "INSTALLED_AT",
    "RETURNS_TO", "CONTROLS",
];

export const TRAVERSE_AGGREGATIONS = ["SUM", "AVG", "MIN", "MAX"] as const;

// exp4j built-in function/constant names — exclude from variable detection
export const EXP4J_BUILTINS = new Set([
    "abs", "acos", "asin", "atan", "cbrt", "ceil", "cos", "cosh",
    "exp", "floor", "log", "log10", "log2", "log1p", "signum",
    "sin", "sinh", "sqrt", "tan", "tanh",
    "e", "pi",   // exp4j built-in constants
]);

// Extract variable names from formula string (case-insensitive identifiers, excluding built-ins)
export function extractVariableNames(formula: string): string[] {
    const matches = formula.match(/\b[a-zA-Z][a-zA-Z0-9_]*\b/g) ?? [];
    return [...new Set(matches)].filter((n) => !EXP4J_BUILTINS.has(n.toLowerCase()));
}

// Slugify display name to machine name
export function slugify(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}
