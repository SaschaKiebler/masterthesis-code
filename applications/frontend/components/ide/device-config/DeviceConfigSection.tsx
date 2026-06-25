"use client";

/**
 * DeviceConfigSection — inline device configuration for the IDE right panel.
 * Shows device identity, template selection, signal map editor, and specs
 * for device-category objects (SENSOR, ACTUATOR, CONTROLLER, GATEWAY, DEVICE, METER).
 *
 * Integrates with:
 *   GET  /objects/{id}/device   — fetch existing config
 *   PATCH /objects/{id}/device  — create or update config
 *   GET  /device-templates      — list available templates for auto-fill
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/Button";
import { getDeviceConfig, updateDeviceConfig, updateObjectProperties } from "@/lib/api/graph";
import { listDeviceTemplates } from "@/lib/api/registry";
import type { DeviceConfig, DeviceTemplate, SignalMapEntry } from "@/lib/api/types";
import {
    Check, X, Plus, ChevronDown, ChevronUp,
    Loader2, AlertCircle, Sparkles, Save,
} from "lucide-react";
import { isDeviceCategory } from "./constants";
import { SectionWrapper } from "./SectionWrapper";
import { FieldRow } from "./FieldRow";
import { SignalMapRow } from "./SignalMapRow";
import { SaveAsTemplateForm } from "./SaveAsTemplateForm";

// ─── Props ──────────────────────────────────────────────────────────────────

interface DeviceConfigSectionProps {
    objectId: string;
    objectTypeName: string;
    objectTypeCategory: string;
}

// ─── Main component ─────────────────────────────────────────────────────────

export function DeviceConfigSection({
    objectId,
    objectTypeName,
    objectTypeCategory,
}: DeviceConfigSectionProps) {
    const [config, setConfig] = useState<DeviceConfig | null>(null);
    const [templates, setTemplates] = useState<DeviceTemplate[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMsg, setSuccessMsg] = useState<string | null>(null);

    // Editable fields
    const [deviceId, setDeviceId] = useState("");
    const [modelHuman, setModelHuman] = useState("");
    const [signalMap, setSignalMap] = useState<Record<string, SignalMapEntry>>({});
    const [showSignalMap, setShowSignalMap] = useState(false);
    const [showTemplates, setShowTemplates] = useState(false);
    const [showSaveAsTemplate, setShowSaveAsTemplate] = useState(false);
    const [dirty, setDirty] = useState(false);

    // Fetch device config and templates on mount / object change
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        setDirty(false);

        async function load() {
            try {
                const [configRes, templatesRes] = await Promise.all([
                    getDeviceConfig(objectId),
                    listDeviceTemplates(),
                ]);

                if (cancelled) return;

                if (configRes?.device) {
                    const d = configRes.device;
                    setConfig(d);
                    setDeviceId(d.deviceId ?? "");
                    setModelHuman(d.modelHuman ?? "");
                    try {
                        const parsed = d.signalMap ? JSON.parse(d.signalMap) : {};
                        setSignalMap(typeof parsed === "object" && parsed !== null ? parsed : {});
                    } catch {
                        setSignalMap({});
                    }
                } else {
                    setConfig(null);
                    setDeviceId("");
                    setModelHuman("");
                    setSignalMap({});
                }

                setTemplates(templatesRes?.deviceTemplates ?? []);
            } catch (e) {
                if (!cancelled) {
                    setError(e instanceof Error ? e.message : "Failed to load device config");
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        load();
        return () => { cancelled = true; };
    }, [objectId]);

    // Filter templates by object type
    const filteredTemplates = useMemo(() => {
        return templates.filter(
            (t) => t.objectType?.name === objectTypeName || !t.objectType
        );
    }, [templates, objectTypeName]);

    // Apply template
    const handleApplyTemplate = useCallback(async (template: DeviceTemplate) => {
        setModelHuman(`${template.manufacturer ?? ""} ${template.name}`.trim());
        if (template.defaultSignalMap) {
            try {
                const parsed = JSON.parse(template.defaultSignalMap);
                if (typeof parsed === "object" && parsed !== null) {
                    setSignalMap(parsed);
                }
            } catch { /* ignore */ }
        }
        setShowTemplates(false);
        setDirty(true);
        setSuccessMsg(`Applied template: ${template.name}`);
        setTimeout(() => setSuccessMsg(null), 2000);

        // ADR-014: Auto-populate custom properties from template
        const customProps: Record<string, string> = {};
        if (template.manufacturer) customProps.manufacturer = template.manufacturer;
        if (template.modelNumber) customProps.model_number = template.modelNumber;
        if (template.protocol) customProps.protocol = template.protocol;
        if (template.defaultSpecs) {
            try { Object.assign(customProps, JSON.parse(template.defaultSpecs)); } catch { /* ignore */ }
        }
        if (Object.keys(customProps).length > 0) {
            try { await updateObjectProperties(objectId, customProps); } catch { /* best-effort */ }
        }
    }, [objectId]);

    // Save
    const handleSave = useCallback(async () => {
        setSaving(true);
        setError(null);
        try {
            const res = await updateDeviceConfig(objectId, {
                deviceId: deviceId.trim() || undefined,
                modelHuman: modelHuman.trim() || undefined,
                signalMap: Object.keys(signalMap).length > 0 ? signalMap : undefined,
            });
            setConfig(res.device);
            setDirty(false);
            setSuccessMsg("Device config saved");
            setTimeout(() => setSuccessMsg(null), 2000);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to save device config");
        } finally {
            setSaving(false);
        }
    }, [objectId, deviceId, modelHuman, signalMap]);

    // Signal map helpers
    const handleAddMetric = useCallback(() => {
        const nextId = String(
            Math.max(0, ...Object.keys(signalMap).map(Number).filter((n) => !isNaN(n))) + 1
        );
        setSignalMap((prev) => ({
            ...prev,
            [nextId]: { name: "", unit: "", source: "", field: "" },
        }));
        setDirty(true);
        setShowSignalMap(true);
    }, [signalMap]);

    const handleUpdateMetric = useCallback((key: string, field: keyof SignalMapEntry, value: string | number) => {
        setSignalMap((prev) => ({
            ...prev,
            [key]: { ...prev[key], [field]: value },
        }));
        setDirty(true);
    }, []);

    const handleRemoveMetric = useCallback((key: string) => {
        setSignalMap((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
        });
        setDirty(true);
    }, []);

    if (!isDeviceCategory(objectTypeCategory)) return null;

    if (loading) {
        return (
            <SectionWrapper title="Device Config">
                <div className="flex items-center gap-2 py-3">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Loading config...</span>
                </div>
            </SectionWrapper>
        );
    }

    const isUnconfigured = !config || !config.deviceId || config.deviceId.startsWith("UNCONFIGURED-");
    const metricEntries = Object.entries(signalMap).sort(
        ([a], [b]) => Number(a) - Number(b)
    );

    return (
        <SectionWrapper
            title="Device Config"
            badge={isUnconfigured ? "Not configured" : undefined}
            badgeColor={isUnconfigured ? "text-amber-500 bg-amber-500/10" : undefined}
        >
            {/* Status messages */}
            {error && (
                <div className="flex items-center gap-1.5 text-xs text-danger mb-2 p-2 bg-danger/5 rounded">
                    <AlertCircle className="h-3 w-3 shrink-0" />
                    {error}
                </div>
            )}
            {successMsg && (
                <div className="flex items-center gap-1.5 text-xs text-emerald-500 mb-2 p-2 bg-emerald-500/5 rounded">
                    <Check className="h-3 w-3 shrink-0" />
                    {successMsg}
                </div>
            )}

            {/* Device ID */}
            <FieldRow label="Device ID" required>
                <input
                    value={deviceId}
                    onChange={(e) => { setDeviceId(e.target.value); setDirty(true); }}
                    placeholder="e.g. shellyswitch25-AABBCC"
                    className="flex-1 h-7 px-2 text-xs bg-background border border-border rounded text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
                />
            </FieldRow>

            {/* Model */}
            <FieldRow label="Model">
                <input
                    value={modelHuman}
                    onChange={(e) => { setModelHuman(e.target.value); setDirty(true); }}
                    placeholder="e.g. Shelly Pro 3EM"
                    className="flex-1 h-7 px-2 text-xs bg-background border border-border rounded text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
                />
            </FieldRow>

            {/* Template selector */}
            {filteredTemplates.length > 0 && (
                <div className="mt-2">
                    <button
                        onClick={() => setShowTemplates(!showTemplates)}
                        className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors"
                    >
                        <Sparkles className="h-3 w-3" />
                        Apply device template
                        {showTemplates ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </button>
                    {showTemplates && (
                        <div className="mt-1.5 space-y-1 max-h-32 overflow-y-auto">
                            {filteredTemplates.map((t) => (
                                <button
                                    key={t.id}
                                    onClick={() => handleApplyTemplate(t)}
                                    className="w-full text-left p-1.5 text-xs rounded border border-border hover:border-primary/50 hover:bg-primary/5 transition-colors"
                                >
                                    <span className="font-medium text-foreground">{t.name}</span>
                                    {t.manufacturer && (
                                        <span className="text-muted-foreground ml-1">({t.manufacturer})</span>
                                    )}
                                    {t.protocol && (
                                        <span className="ml-1 text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground">
                                            {t.protocol}
                                        </span>
                                    )}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Save as Template */}
            {Object.keys(signalMap).length > 0 && (
                <div className="mt-2">
                    <button
                        onClick={() => setShowSaveAsTemplate(!showSaveAsTemplate)}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <Save className="h-3 w-3" />
                        Save as template
                        {showSaveAsTemplate ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </button>
                    {showSaveAsTemplate && (
                        <SaveAsTemplateForm
                            signalMap={signalMap}
                            modelHuman={modelHuman}
                            objectTypeName={objectTypeName}
                            onSaved={(name) => {
                                setShowSaveAsTemplate(false);
                                setSuccessMsg(`Template "${name}" created`);
                                setTimeout(() => setSuccessMsg(null), 2000);
                                // Refresh templates list
                                listDeviceTemplates().then((res) => {
                                    setTemplates(res?.deviceTemplates ?? []);
                                });
                            }}
                            onCancel={() => setShowSaveAsTemplate(false)}
                        />
                    )}
                </div>
            )}

            {/* Signal Map */}
            <div className="mt-3">
                <div className="flex items-center justify-between mb-1.5">
                    <button
                        onClick={() => setShowSignalMap(!showSignalMap)}
                        className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors"
                    >
                        Signal Map
                        <span className="text-[10px] font-normal text-muted-foreground/60 tabular-nums lowercase">
                            {metricEntries.length}
                        </span>
                        {showSignalMap ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </button>
                    <button
                        onClick={handleAddMetric}
                        className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        title="Add metric"
                    >
                        <Plus className="h-3.5 w-3.5" />
                    </button>
                </div>

                {showSignalMap && (
                    <div className="space-y-1.5">
                        {metricEntries.length === 0 && (
                            <p className="text-xs text-muted-foreground py-1">
                                No signal map entries. Add metrics or apply a template.
                            </p>
                        )}
                        {metricEntries.map(([key, entry]) => (
                            <SignalMapRow
                                key={key}
                                metricId={key}
                                entry={entry}
                                onUpdate={(field, value) => handleUpdateMetric(key, field, value)}
                                onRemove={() => handleRemoveMetric(key)}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* Save button */}
            {dirty && (
                <div className="mt-3 flex gap-1.5">
                    <Button size="sm" onClick={handleSave} loading={saving}>
                        <Check className="h-3.5 w-3.5 mr-1" /> Save Config
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                            // Reset to loaded state
                            if (config) {
                                setDeviceId(config.deviceId ?? "");
                                setModelHuman(config.modelHuman ?? "");
                                try {
                                    const parsed = config.signalMap ? JSON.parse(config.signalMap) : {};
                                    setSignalMap(typeof parsed === "object" && parsed !== null ? parsed : {});
                                } catch { setSignalMap({}); }
                            } else {
                                setDeviceId("");
                                setModelHuman("");
                                setSignalMap({});
                            }
                            setDirty(false);
                        }}
                    >
                        <X className="h-3.5 w-3.5 mr-1" /> Discard
                    </Button>
                </div>
            )}
        </SectionWrapper>
    );
}
