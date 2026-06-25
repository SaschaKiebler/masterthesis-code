"use client";

import { useState, useCallback } from "react";
import { Trash2, Loader2 } from "lucide-react";
import {
    isStateChangeOperator,
    type DeviceThresholdRule,
} from "@/lib/api/thresholdRules";
import { OPERATOR_LABELS, SEVERITY_STYLES, formatCooldown } from "./helpers";

// ── Rule row ──────────────────────────────────────────────────────────────────

export interface RuleRowProps {
    rule: DeviceThresholdRule;
    onToggle: (enabled: boolean) => Promise<void>;
    onDelete: () => Promise<void>;
}

export function RuleRow({ rule, onToggle, onDelete }: RuleRowProps) {
    const [toggling, setToggling] = useState(false);
    const [deleting, setDeleting] = useState(false);

    const handleToggle = useCallback(async () => {
        setToggling(true);
        try { await onToggle(!rule.enabled); }
        finally { setToggling(false); }
    }, [rule.enabled, onToggle]);

    const handleDelete = useCallback(async () => {
        if (!confirm("Delete this alert rule?")) return;
        setDeleting(true);
        try { await onDelete(); }
        finally { setDeleting(false); }
    }, [onDelete]);

    const isStateChange = isStateChangeOperator(rule.operator);

    return (
        <div className={`flex items-center gap-2 py-1.5 px-2 rounded-lg ${rule.enabled ? "" : "opacity-50"}`}>
            {/* Metric name */}
            <span className="text-[10px] text-muted-foreground truncate max-w-[80px]" title={rule.metricPointName}>
                {rule.metricPointName}
            </span>

            {/* Condition */}
            <span className="text-xs font-mono font-medium text-foreground whitespace-nowrap">
                {isStateChange
                    ? OPERATOR_LABELS[rule.operator]
                    : `${OPERATOR_LABELS[rule.operator]} ${rule.threshold}`}
            </span>

            {/* Severity badge */}
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide shrink-0 ${SEVERITY_STYLES[rule.severity]}`}>
                {rule.severity}
            </span>

            {/* Cooldown */}
            <span className="text-[10px] text-muted-foreground ml-auto whitespace-nowrap shrink-0">
                {formatCooldown(rule.cooldownSeconds)}
            </span>

            {/* Enabled toggle */}
            <button
                onClick={handleToggle}
                disabled={toggling}
                title={rule.enabled ? "Disable rule" : "Enable rule"}
                className={`relative w-7 h-4 p-0 rounded-full overflow-hidden transition-colors shrink-0 ${
                    rule.enabled ? "bg-primary" : "bg-muted-foreground/30"
                } ${toggling ? "opacity-50" : ""}`}
            >
                <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform ${
                    rule.enabled ? "translate-x-0.5" : "-translate-x-3.5"
                }`} />
            </button>

            {/* Delete */}
            <button
                onClick={handleDelete}
                disabled={deleting}
                className="p-0.5 rounded text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors shrink-0"
                title="Delete rule"
            >
                {deleting
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : <Trash2 className="h-3 w-3" />
                }
            </button>
        </div>
    );
}
