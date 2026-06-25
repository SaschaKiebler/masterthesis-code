"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Bell, AlertCircle, Loader2 } from "lucide-react";
import { Section } from "./Section";
import {
    listDeviceRules,
    createThresholdRule,
    updateThresholdRule,
    deleteThresholdRule,
    type DeviceThresholdRule,
} from "@/lib/api/thresholdRules";
import { getDeviceMetricPoints, type DeviceMetricPoint } from "@/lib/api/graph";
import { RuleRow } from "./alert-rules/RuleRow";
import { AddRuleForm } from "./alert-rules/AddRuleForm";

// ── Main section ──────────────────────────────────────────────────────────────

interface DeviceAlertRulesSectionProps {
    objectId: string;
}

export function DeviceAlertRulesSection({ objectId }: DeviceAlertRulesSectionProps) {
    const [rules, setRules]             = useState<DeviceThresholdRule[]>([]);
    const [metricPoints, setMetricPoints] = useState<DeviceMetricPoint[]>([]);
    const [loading, setLoading]         = useState(true);
    const [error, setError]             = useState<string | null>(null);
    const [showForm, setShowForm]       = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [rulesData, mps] = await Promise.all([
                listDeviceRules(objectId),
                getDeviceMetricPoints(objectId),
            ]);
            setRules(rulesData);
            setMetricPoints(mps);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load alert rules");
        } finally {
            setLoading(false);
        }
    }, [objectId]);

    useEffect(() => { load(); }, [load]);

    const handleAdd = useCallback(async (
        metricPointId: string,
        data: Parameters<typeof createThresholdRule>[1]
    ) => {
        await createThresholdRule(metricPointId, data);
        setShowForm(false);
        await load();
    }, [load]);

    const handleToggle = useCallback(async (ruleId: string, enabled: boolean) => {
        const updated = await updateThresholdRule(ruleId, { enabled });
        setRules((prev) => prev.map((r) => r.id === ruleId
            ? { ...updated, metricPointName: r.metricPointName }
            : r
        ));
    }, []);

    const handleDelete = useCallback(async (ruleId: string) => {
        await deleteThresholdRule(ruleId);
        setRules((prev) => prev.filter((r) => r.id !== ruleId));
    }, []);

    return (
        <Section
            title="Alert Rules"
            count={rules.length}
            action={
                <button
                    onClick={() => setShowForm((v) => !v)}
                    className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    title="Add alert rule"
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
                    <Bell className="h-3.5 w-3.5 shrink-0" />
                    No alert rules yet. Click + to add one.
                </div>
            )}

            {!loading && rules.map((rule) => (
                <RuleRow
                    key={rule.id}
                    rule={rule}
                    onToggle={(enabled) => handleToggle(rule.id, enabled)}
                    onDelete={() => handleDelete(rule.id)}
                />
            ))}

            {showForm && (
                <AddRuleForm
                    metricPoints={metricPoints}
                    onSave={handleAdd}
                    onCancel={() => setShowForm(false)}
                />
            )}
        </Section>
    );
}
