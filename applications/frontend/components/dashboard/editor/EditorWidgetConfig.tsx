"use client";

/**
 * EditorWidgetConfig — right panel of the Dashboard Editor.
 * Shows configuration form for the currently selected widget.
 * Sections: General, Data Source (varies by type), Display, Actions.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/Button";
import { getDeviceConfig } from "@/lib/api/graph";
import { getMetricPoints, type MetricPoint } from "@/lib/api/metric-points";
import { listKpiFormulas, type KpiFormula } from "@/lib/api/kpiFormulas";
import { TIME_PRESET_SECONDS, bucketForPreset } from "@/lib/utils/timeBuckets";
import type { DashboardWidget, WidgetConfig, WidgetPosition, GraphObject, SignalMapEntry } from "@/lib/api/types";
import type { WidgetType } from "./useEditorState";
import {
    LineChart, Gauge, Activity, BarChart3, Flame,
    Settings2, Database, Monitor, Copy, Trash2, Plus, X,
    ChevronDown, ChevronUp, Clock, Brain, Bell, GitBranch, ArrowRightLeft, List,
} from "lucide-react";

// ─── Widget type options ────────────────────────────────────────────────────

const WIDGET_TYPE_OPTIONS: { value: WidgetType; label: string; icon: React.ElementType }[] = [
    { value: "stat_card", label: "Stat Card", icon: BarChart3 },
    { value: "time_series", label: "Time Series", icon: LineChart },
    { value: "gauge", label: "Gauge", icon: Gauge },
    { value: "status", label: "Status", icon: Activity },
    { value: "derived_property", label: "Derived Property", icon: Brain },
    { value: "event_timeline", label: "Event Timeline", icon: Bell },
    { value: "comparison", label: "Comparison", icon: GitBranch },
    { value: "event_log", label: "Event Log", icon: List },
];

// ─── Props ──────────────────────────────────────────────────────────────────

interface EditorWidgetConfigProps {
    widget: DashboardWidget | null;
    scopedObjects: GraphObject[];
    onUpdateWidget: (widgetId: string, updates: Partial<DashboardWidget>) => void;
    onUpdateConfig: (widgetId: string, config: Partial<WidgetConfig>) => void;
    onUpdatePosition: (widgetId: string, position: Partial<WidgetPosition>) => void;
    onDuplicate: (widgetId: string) => void;
    onRemove: (widgetId: string) => void;
    maxColumns: number;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function EditorWidgetConfig({
    widget,
    scopedObjects,
    onUpdateWidget,
    onUpdateConfig,
    onUpdatePosition,
    onDuplicate,
    onRemove,
    maxColumns,
}: EditorWidgetConfigProps) {
    if (!widget) {
        return <EmptyState />;
    }

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <div className="flex-1 overflow-y-auto">
                <GeneralSection
                    widget={widget}
                    onUpdateWidget={onUpdateWidget}
                />
                <DataSourceSection
                    widget={widget}
                    scopedObjects={scopedObjects}
                    onUpdateWidget={onUpdateWidget}
                    onUpdateConfig={onUpdateConfig}
                />
                {(widget.type === "stat_card" || widget.type === "gauge") && (
                    <ValueTransformSection
                        widget={widget}
                        onUpdateConfig={onUpdateConfig}
                    />
                )}
                <DisplaySection
                    widget={widget}
                    onUpdatePosition={onUpdatePosition}
                    maxColumns={maxColumns}
                />
            </div>

            {/* Actions footer */}
            <div className="border-t border-border px-4 py-3 shrink-0 flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => onDuplicate(widget.id)}>
                    <Copy className="h-3.5 w-3.5 mr-1.5" /> Duplicate
                </Button>
                <Button size="sm" variant="danger" onClick={() => onRemove(widget.id)}>
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete
                </Button>
            </div>
        </div>
    );
}

// ─── Empty state ────────────────────────────────────────────────────────────

function EmptyState() {
    return (
        <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <div className="p-3 rounded-full bg-muted/50 mb-3">
                <Settings2 className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">Select a widget to configure it.</p>
            <p className="text-xs text-muted-foreground/60 mt-2">
                Click on any widget in the preview area.
            </p>
        </div>
    );
}

// ─── General section ────────────────────────────────────────────────────────

function GeneralSection({
    widget,
    onUpdateWidget,
}: {
    widget: DashboardWidget;
    onUpdateWidget: (widgetId: string, updates: Partial<DashboardWidget>) => void;
}) {
    return (
        <SectionWrapper title="General" icon={Settings2}>
            {/* Title */}
            <FieldRow label="Title">
                <input
                    value={widget.title}
                    onChange={(e) => onUpdateWidget(widget.id, { title: e.target.value })}
                    className="flex-1 h-7 px-2 text-xs bg-background border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
            </FieldRow>

            {/* Widget Type */}
            <FieldRow label="Type">
                <select
                    value={widget.type}
                    onChange={(e) => onUpdateWidget(widget.id, { type: e.target.value as WidgetType })}
                    className="flex-1 h-7 px-2 text-xs bg-background border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                    {WIDGET_TYPE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                </select>
            </FieldRow>
        </SectionWrapper>
    );
}

// ─── Data Source section ────────────────────────────────────────────────────

function DataSourceSection({
    widget,
    scopedObjects,
    onUpdateWidget,
    onUpdateConfig,
}: {
    widget: DashboardWidget;
    scopedObjects: GraphObject[];
    onUpdateWidget: (widgetId: string, updates: Partial<DashboardWidget>) => void;
    onUpdateConfig: (widgetId: string, config: Partial<WidgetConfig>) => void;
}) {
    switch (widget.type) {
        case "stat_card":
        case "gauge":
        case "status":
        case "event_log":
            return (
                <SingleAssetDataSource
                    widget={widget}
                    scopedObjects={scopedObjects}
                    onUpdateWidget={onUpdateWidget}
                    onUpdateConfig={onUpdateConfig}
                />
            );
        case "time_series":
            return (
                <TimeSeriesDataSource
                    widget={widget}
                    scopedObjects={scopedObjects}
                    onUpdateConfig={onUpdateConfig}
                />
            );
        case "derived_property":
            return (
                <DerivedPropertyDataSource
                    widget={widget}
                    scopedObjects={scopedObjects}
                    onUpdateConfig={onUpdateConfig}
                />
            );
        case "event_timeline":
            return (
                <EventTimelineDataSource
                    widget={widget}
                    onUpdateConfig={onUpdateConfig}
                />
            );
        case "comparison":
            return (
                <ComparisonDataSource
                    widget={widget}
                    scopedObjects={scopedObjects}
                    onUpdateConfig={onUpdateConfig}
                />
            );
        default:
            return null;
    }
}

// ─── Single asset data source (stat_card, gauge, status) ────────────────────

function SingleAssetDataSource({
    widget,
    scopedObjects,
    onUpdateWidget,
    onUpdateConfig,
}: {
    widget: DashboardWidget;
    scopedObjects: GraphObject[];
    onUpdateWidget: (widgetId: string, updates: Partial<DashboardWidget>) => void;
    onUpdateConfig: (widgetId: string, config: Partial<WidgetConfig>) => void;
}) {
    const [metricPoints, setMetricPoints] = useState<MetricPoint[]>([]);
    const [metrics, setMetrics] = useState<Record<string, SignalMapEntry>>({});
    const [kpiFormulas, setKpiFormulas] = useState<KpiFormula[]>([]);
    const [loadingMetrics, setLoadingMetrics] = useState(false);

    const assetId = widget.config.assetId;

    // Fetch metric points + KPI formulas when asset changes; fall back to signal_map if no metric points
    useEffect(() => {
        if (!assetId) { setMetricPoints([]); setMetrics({}); setKpiFormulas([]); return; }
        let cancelled = false;
        setLoadingMetrics(true);
        Promise.all([
            getMetricPoints(assetId),
            listKpiFormulas(assetId).catch(() => [] as KpiFormula[]),
        ])
            .then(async ([points, formulas]) => {
                if (cancelled) return;
                setKpiFormulas(formulas.filter((f) => f.enabled));
                if (points.length > 0) {
                    setMetricPoints(points);
                    setMetrics({});
                } else {
                    setMetricPoints([]);
                    const res = await getDeviceConfig(assetId);
                    if (cancelled) return;
                    if (res?.device?.signalMap) {
                        try {
                            const parsed = JSON.parse(res.device.signalMap);
                            setMetrics(typeof parsed === "object" && parsed !== null ? parsed : {});
                        } catch { setMetrics({}); }
                    } else {
                        setMetrics({});
                    }
                }
            })
            .catch(() => { if (!cancelled) { setMetricPoints([]); setMetrics({}); setKpiFormulas([]); } })
            .finally(() => { if (!cancelled) setLoadingMetrics(false); });
        return () => { cancelled = true; };
    }, [assetId]);

    const metricEntries = useMemo(
        () => Object.entries(metrics).sort(([a], [b]) => Number(a) - Number(b)),
        [metrics]
    );

    const DEVICE_CATEGORIES = ["SENSOR", "ACTUATOR", "CONTROLLER", "GATEWAY", "DEVICE", "METER"];
    const deviceObjects = useMemo(
        () => scopedObjects.filter((o) => DEVICE_CATEGORIES.includes(o.objectTypeCategory)),
        [scopedObjects]
    );
    const otherObjects = useMemo(
        () => scopedObjects.filter((o) => !DEVICE_CATEGORIES.includes(o.objectTypeCategory)),
        [scopedObjects]
    );

    return (
        <SectionWrapper title="Data Source" icon={Database}>
            {/* Asset picker */}
            <FieldRow label="Asset">
                <select
                    value={assetId ?? ""}
                    onChange={(e) => onUpdateConfig(widget.id, { assetId: e.target.value || undefined, metric: undefined, kpiFormulaId: undefined, metricPointId: undefined, metricId: undefined })}
                    className="flex-1 h-7 px-2 text-xs bg-background border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                    <option value="">Select asset...</option>
                    {deviceObjects.map((o) => (
                        <option key={o.id} value={o.id}>{o.displayName} ({o.objectTypeName})</option>
                    ))}
                    {otherObjects.length > 0 && (
                        <optgroup label="Other Objects">
                            {otherObjects.map((o) => (
                                <option key={o.id} value={o.id}>{o.displayName} ({o.objectTypeName})</option>
                            ))}
                        </optgroup>
                    )}
                </select>
            </FieldRow>

            {/* Metric picker */}
            <FieldRow label="Metric">
                {loadingMetrics ? (
                    <span className="text-xs text-muted-foreground">Loading...</span>
                ) : metricPoints.length > 0 ? (
                    <select
                        value={widget.config.kpiFormulaId ? `kpi:${widget.config.kpiFormulaId}` : (widget.config.metricPointId ?? "")}
                        onChange={(e) => {
                            const val = e.target.value;
                            if (val.startsWith("kpi:")) {
                                const kpiId = val.slice(4);
                                const kpi = kpiFormulas.find((k) => k.id === kpiId);
                                onUpdateConfig(widget.id, {
                                    kpiFormulaId: kpiId,
                                    metricPointId: undefined,
                                    metricId: undefined,
                                    metric: undefined,
                                    yAxis: { ...widget.config.yAxis, unit: kpi?.unit || undefined },
                                });
                                if (kpi) onUpdateWidget(widget.id, { title: kpi.displayName });
                            } else {
                                const mp = metricPoints.find((p) => p.id === val);
                                onUpdateConfig(widget.id, {
                                    kpiFormulaId: undefined,
                                    metricPointId: mp?.id,
                                    metricId: mp?.metricId,
                                    metric: mp?.id,
                                    yAxis: { ...widget.config.yAxis, unit: mp?.unit || undefined },
                                });
                                if (mp) {
                                    const label = mp.displayName ?? mp.quantityDisplayName ?? mp.quantityName ?? mp.field ?? mp.source ?? `Metric ${mp.metricId}`;
                                    onUpdateWidget(widget.id, { title: label });
                                }
                            }
                        }}
                        className="flex-1 h-7 px-2 text-xs bg-background border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                        <option value="">Select metric...</option>
                        {metricPoints.map((mp) => {
                            const label = mp.displayName ?? mp.quantityDisplayName ?? mp.quantityName ?? mp.field ?? mp.source ?? `Metric ${mp.metricId}`;
                            return (
                                <option key={mp.id} value={mp.id}>
                                    {label}{mp.unit ? ` (${mp.unit})` : ""}
                                </option>
                            );
                        })}
                        {kpiFormulas.length > 0 && (
                            <optgroup label="Computed KPIs">
                                {kpiFormulas.map((kpi) => (
                                    <option key={kpi.id} value={`kpi:${kpi.id}`}>
                                        {kpi.displayName}{kpi.unit ? ` (${kpi.unit})` : ""}
                                    </option>
                                ))}
                            </optgroup>
                        )}
                    </select>
                ) : (
                    <select
                        value={widget.config.kpiFormulaId ? `kpi:${widget.config.kpiFormulaId}` : (widget.config.metric ?? "")}
                        onChange={(e) => {
                            const val = e.target.value;
                            if (val.startsWith("kpi:")) {
                                const kpiId = val.slice(4);
                                const kpi = kpiFormulas.find((k) => k.id === kpiId);
                                onUpdateConfig(widget.id, {
                                    kpiFormulaId: kpiId,
                                    metric: undefined,
                                    metricPointId: undefined,
                                    metricId: undefined,
                                    yAxis: { ...widget.config.yAxis, unit: kpi?.unit || undefined },
                                });
                                if (kpi) onUpdateWidget(widget.id, { title: kpi.displayName });
                            } else {
                                const metricName = val || undefined;
                                const matched = metricEntries.find(([, ent]) => ent.name === metricName);
                                const unit = matched?.[1]?.unit;
                                onUpdateConfig(widget.id, {
                                    kpiFormulaId: undefined,
                                    metric: metricName,
                                    yAxis: { ...widget.config.yAxis, unit: unit || undefined },
                                });
                                if (metricName) {
                                    const readable = metricName.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
                                    onUpdateWidget(widget.id, { title: readable });
                                }
                            }
                        }}
                        disabled={metricEntries.length === 0 && kpiFormulas.length === 0}
                        className="flex-1 h-7 px-2 text-xs bg-background border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                    >
                        <option value="">{metricEntries.length === 0 && kpiFormulas.length === 0 ? "No metrics" : "Select metric..."}</option>
                        {metricEntries.map(([key, entry]) => (
                            <option key={key} value={entry.name || key}>
                                {entry.name || `Metric ${key}`}{entry.unit ? ` (${entry.unit})` : ""}
                            </option>
                        ))}
                        {kpiFormulas.length > 0 && (
                            <optgroup label="Computed KPIs">
                                {kpiFormulas.map((kpi) => (
                                    <option key={kpi.id} value={`kpi:${kpi.id}`}>
                                        {kpi.displayName}{kpi.unit ? ` (${kpi.unit})` : ""}
                                    </option>
                                ))}
                            </optgroup>
                        )}
                    </select>
                )}
            </FieldRow>

            {/* Gauge-specific: min/max */}
            {widget.type === "gauge" && (
                <>
                    <FieldRow label="Min">
                        <input
                            type="number"
                            value={widget.config.yAxis?.min ?? ""}
                            onChange={(e) => onUpdateConfig(widget.id, {
                                yAxis: { ...widget.config.yAxis, min: e.target.value ? Number(e.target.value) : undefined }
                            })}
                            className="flex-1 h-7 px-2 text-xs bg-background border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                            placeholder="0"
                        />
                    </FieldRow>
                    <FieldRow label="Max">
                        <input
                            type="number"
                            value={widget.config.yAxis?.max ?? ""}
                            onChange={(e) => onUpdateConfig(widget.id, {
                                yAxis: { ...widget.config.yAxis, max: e.target.value ? Number(e.target.value) : undefined }
                            })}
                            className="flex-1 h-7 px-2 text-xs bg-background border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                            placeholder="100"
                        />
                    </FieldRow>
                </>
            )}

            {/* Status / Event Log: states */}
            {(widget.type === "status" || widget.type === "event_log") && (
                <StatusStatesEditor widget={widget} onUpdateConfig={onUpdateConfig} />
            )}

            {/* Event Log: time range preset */}
            {widget.type === "event_log" && (
                <div className="mt-3 pt-2 border-t border-border/30">
                    <div className="flex items-center gap-1 mb-1.5">
                        <Clock className="h-3 w-3 text-muted-foreground" />
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Time Range</p>
                    </div>
                    <FieldRow label="Preset">
                        <select
                            value={widget.config.timePreset ?? ""}
                            onChange={(e) => onUpdateConfig(widget.id, { timePreset: e.target.value || undefined })}
                            className="flex-1 h-7 px-2 text-xs bg-background border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        >
                            <option value="">Page default</option>
                            {Object.keys(TIME_PRESET_SECONDS).map((key) => (
                                <option key={key} value={key}>{key}</option>
                            ))}
                        </select>
                    </FieldRow>
                </div>
            )}
        </SectionWrapper>
    );
}

// ─── Status states editor ───────────────────────────────────────────────────

function StatusStatesEditor({
    widget,
    onUpdateConfig,
}: {
    widget: DashboardWidget;
    onUpdateConfig: (widgetId: string, config: Partial<WidgetConfig>) => void;
}) {
    const states = widget.config.states ?? {};
    const entries = Object.entries(states);
    const [expanded, setExpanded] = useState(false);

    const handleAddState = useCallback(() => {
        const nextKey = String(entries.length);
        onUpdateConfig(widget.id, {
            states: { ...states, [nextKey]: { label: "State", color: "#6b7280" } },
        });
        setExpanded(true);
    }, [widget.id, states, entries.length, onUpdateConfig]);

    const handleRemoveState = useCallback((key: string) => {
        const next = { ...states };
        delete next[key];
        onUpdateConfig(widget.id, { states: next });
    }, [widget.id, states, onUpdateConfig]);

    return (
        <div className="mt-2">
            <div className="flex items-center justify-between">
                <button
                    onClick={() => setExpanded(!expanded)}
                    className="flex items-center gap-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide"
                >
                    States
                    <span className="text-[10px] font-normal">{entries.length}</span>
                    {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </button>
                <button
                    onClick={handleAddState}
                    className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                    <Plus className="h-3.5 w-3.5" />
                </button>
            </div>
            {expanded && (
                <div className="mt-1.5 space-y-1">
                    {entries.map(([key, state]) => (
                        <div key={key} className="flex items-center gap-1.5 p-1.5 border border-border rounded bg-background/50">
                            <input
                                value={key}
                                readOnly
                                className="w-8 h-6 px-1 text-[10px] font-mono text-center bg-muted border-none rounded text-muted-foreground"
                            />
                            <input
                                value={state.label}
                                onChange={(e) => onUpdateConfig(widget.id, {
                                    states: { ...states, [key]: { ...state, label: e.target.value } }
                                })}
                                className="flex-1 h-6 px-1.5 text-xs bg-transparent border-none text-foreground focus:outline-none"
                                placeholder="Label"
                            />
                            <input
                                type="color"
                                value={state.color}
                                onChange={(e) => onUpdateConfig(widget.id, {
                                    states: { ...states, [key]: { ...state, color: e.target.value } }
                                })}
                                className="w-6 h-6 rounded cursor-pointer border-none"
                            />
                            <button
                                onClick={() => handleRemoveState(key)}
                                className="p-0.5 rounded text-muted-foreground hover:text-danger transition-colors"
                            >
                                <X className="h-3 w-3" />
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── Time Series data source ────────────────────────────────────────────────

function TimeSeriesDataSource({
    widget,
    scopedObjects,
    onUpdateConfig,
}: {
    widget: DashboardWidget;
    scopedObjects: GraphObject[];
    onUpdateConfig: (widgetId: string, config: Partial<WidgetConfig>) => void;
}) {
    const series = widget.config.series ?? [];

    const handleAddSeries = useCallback(() => {
        onUpdateConfig(widget.id, {
            series: [...series, { assetId: "", metric: "", color: "#3b82f6", label: "" }],
        });
    }, [widget.id, series, onUpdateConfig]);

    const handleUpdateSeries = useCallback((idx: number, updates: Partial<typeof series[0]>) => {
        const next = series.map((s, i) => i === idx ? { ...s, ...updates } : s);
        onUpdateConfig(widget.id, { series: next });
    }, [widget.id, series, onUpdateConfig]);

    const handleRemoveSeries = useCallback((idx: number) => {
        onUpdateConfig(widget.id, { series: series.filter((_, i) => i !== idx) });
    }, [widget.id, series, onUpdateConfig]);

    return (
        <SectionWrapper title="Data Source" icon={Database}>
            <div className="space-y-2">
                {series.map((s, idx) => (
                    <TimeSeriesRow
                        key={idx}
                        entry={s}
                        index={idx}
                        scopedObjects={scopedObjects}
                        onUpdate={(updates) => handleUpdateSeries(idx, updates)}
                        onRemove={() => handleRemoveSeries(idx)}
                    />
                ))}
            </div>
            <button
                onClick={handleAddSeries}
                className="flex items-center gap-1.5 mt-2 text-xs text-primary hover:text-primary/80 transition-colors"
            >
                <Plus className="h-3 w-3" />
                Add Series
            </button>

            {/* Time Range config */}
            <div className="mt-3 pt-2 border-t border-border/30">
                <div className="flex items-center gap-1 mb-1.5">
                    <Clock className="h-3 w-3 text-muted-foreground" />
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Time Range</p>
                </div>
                <FieldRow label="Preset">
                    <select
                        value={widget.config.timePreset ?? ""}
                        onChange={(e) => onUpdateConfig(widget.id, { timePreset: e.target.value || undefined })}
                        className="flex-1 h-7 px-2 text-xs bg-background border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                        <option value="">Page default</option>
                        {Object.keys(TIME_PRESET_SECONDS).map((key) => (
                            <option key={key} value={key}>{key}</option>
                        ))}
                    </select>
                </FieldRow>
                <FieldRow label="Bucket">
                    <select
                        value={widget.config.bucketMinutes != null ? String(widget.config.bucketMinutes) : ""}
                        onChange={(e) => onUpdateConfig(widget.id, { bucketMinutes: e.target.value !== "" ? Number(e.target.value) : undefined })}
                        className="flex-1 h-7 px-2 text-xs bg-background border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                        <option value="">
                            Auto{widget.config.timePreset ? ` (${bucketForPreset(widget.config.timePreset)}min)` : ""}
                        </option>
                        <option value="0">All (raw)</option>
                        <option value="1">1 min</option>
                        <option value="5">5 min</option>
                        <option value="15">15 min</option>
                        <option value="60">1 hour</option>
                        <option value="360">6 hours</option>
                        <option value="1440">1 day</option>
                    </select>
                </FieldRow>
            </div>

            {/* Y-Axis config */}
            <div className="mt-3 pt-2 border-t border-border/30">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Y-Axis</p>
                <div className="flex gap-2">
                    <div className="flex-1">
                        <label className="text-[10px] text-muted-foreground">Min</label>
                        <input
                            type="number"
                            value={widget.config.yAxis?.min ?? ""}
                            onChange={(e) => onUpdateConfig(widget.id, {
                                yAxis: { ...widget.config.yAxis, min: e.target.value ? Number(e.target.value) : undefined }
                            })}
                            className="w-full h-6 px-1.5 text-xs bg-background border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                    </div>
                    <div className="flex-1">
                        <label className="text-[10px] text-muted-foreground">Max</label>
                        <input
                            type="number"
                            value={widget.config.yAxis?.max ?? ""}
                            onChange={(e) => onUpdateConfig(widget.id, {
                                yAxis: { ...widget.config.yAxis, max: e.target.value ? Number(e.target.value) : undefined }
                            })}
                            className="w-full h-6 px-1.5 text-xs bg-background border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                    </div>
                    <div className="flex-1">
                        <label className="text-[10px] text-muted-foreground">Unit</label>
                        <input
                            value={widget.config.yAxis?.unit ?? ""}
                            onChange={(e) => onUpdateConfig(widget.id, {
                                yAxis: { ...widget.config.yAxis, unit: e.target.value || undefined }
                            })}
                            className="w-full h-6 px-1.5 text-xs bg-background border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                            placeholder="°C"
                        />
                    </div>
                </div>
            </div>
        </SectionWrapper>
    );
}

// ─── Time Series Row ────────────────────────────────────────────────────────

type TimeSeriesEntry = {
    metricPointId?: string;
    metricId?: number;
    assetId?: string;
    metric?: string;
    color?: string;
    label?: string;
    kpiFormulaId?: string;
};

const TS_DEVICE_CATEGORIES = ["SENSOR", "ACTUATOR", "CONTROLLER", "GATEWAY", "DEVICE", "METER"];

function TimeSeriesRow({
    entry,
    index,
    scopedObjects,
    onUpdate,
    onRemove,
}: {
    entry: TimeSeriesEntry;
    index: number;
    scopedObjects: GraphObject[];
    onUpdate: (updates: Partial<TimeSeriesEntry>) => void;
    onRemove: () => void;
}) {
    const deviceObjects = useMemo(
        () => scopedObjects.filter((o) => TS_DEVICE_CATEGORIES.includes(o.objectTypeCategory)),
        [scopedObjects]
    );
    const otherObjects = useMemo(
        () => scopedObjects.filter((o) => !TS_DEVICE_CATEGORIES.includes(o.objectTypeCategory)),
        [scopedObjects]
    );
    const [metricPoints, setMetricPoints] = useState<MetricPoint[]>([]);
    const [metrics, setMetrics] = useState<Record<string, SignalMapEntry>>({});
    const [kpiFormulas, setKpiFormulas] = useState<KpiFormula[]>([]);

    useEffect(() => {
        const assetId = entry.assetId;
        if (!assetId) { setMetricPoints([]); setMetrics({}); setKpiFormulas([]); return; }
        let cancelled = false;
        Promise.all([
            getMetricPoints(assetId),
            listKpiFormulas(assetId).catch(() => [] as KpiFormula[]),
        ])
            .then(async ([points, formulas]) => {
                if (cancelled) return;
                setKpiFormulas(formulas.filter((f) => f.enabled));
                if (points.length > 0) {
                    setMetricPoints(points);
                    setMetrics({});
                } else {
                    setMetricPoints([]);
                    const res = await getDeviceConfig(assetId);
                    if (cancelled) return;
                    if (res?.device?.signalMap) {
                        try {
                            const parsed = JSON.parse(res.device.signalMap);
                            setMetrics(typeof parsed === "object" && parsed !== null ? parsed : {});
                        } catch { setMetrics({}); }
                    } else { setMetrics({}); }
                }
            })
            .catch(() => { if (!cancelled) { setMetricPoints([]); setMetrics({}); setKpiFormulas([]); } });
        return () => { cancelled = true; };
    }, [entry.assetId]);

    const metricEntries = useMemo(
        () => Object.entries(metrics).sort(([a], [b]) => Number(a) - Number(b)),
        [metrics]
    );

    return (
        <div className="p-2 border border-border rounded bg-background/50 space-y-1.5">
            <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground w-4 shrink-0">#{index + 1}</span>
                <input
                    type="color"
                    value={entry.color ?? "#3b82f6"}
                    onChange={(e) => onUpdate({ color: e.target.value })}
                    className="w-5 h-5 rounded cursor-pointer border-none shrink-0"
                />
                <input
                    value={entry.label ?? ""}
                    onChange={(e) => onUpdate({ label: e.target.value })}
                    placeholder="Label"
                    className="flex-1 h-6 px-1.5 text-xs bg-transparent border-none text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
                />
                <button
                    onClick={onRemove}
                    className="p-0.5 rounded text-muted-foreground hover:text-danger transition-colors shrink-0"
                >
                    <X className="h-3 w-3" />
                </button>
            </div>
            <select
                value={entry.assetId ?? ""}
                onChange={(e) => onUpdate({ assetId: e.target.value, metric: "", kpiFormulaId: undefined, metricPointId: undefined, metricId: undefined })}
                className="w-full h-6 px-1.5 text-xs bg-background border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
                <option value="">Select asset...</option>
                {deviceObjects.map((o) => (
                    <option key={o.id} value={o.id}>{o.displayName}</option>
                ))}
                {otherObjects.length > 0 && (
                    <optgroup label="Other Objects">
                        {otherObjects.map((o) => (
                            <option key={o.id} value={o.id}>{o.displayName} ({o.objectTypeName})</option>
                        ))}
                    </optgroup>
                )}
            </select>
            {/* Metric picker: prefer metric points, fall back to signal_map; always include KPIs */}
            {metricPoints.length > 0 ? (
                <select
                    value={entry.kpiFormulaId ? `kpi:${entry.kpiFormulaId}` : (entry.metric ?? "")}
                    onChange={(e) => {
                        const val = e.target.value;
                        if (val.startsWith("kpi:")) {
                            const kpiId = val.slice(4);
                            const kpi = kpiFormulas.find((k) => k.id === kpiId);
                            onUpdate({
                                kpiFormulaId: kpiId,
                                metric: undefined,
                                metricPointId: undefined,
                                metricId: undefined,
                                label: entry.label || kpi?.displayName || "",
                            });
                        } else {
                            const mp = metricPoints.find((p) => p.id === val);
                            const label = mp
                                ? (mp.displayName ?? mp.quantityDisplayName ?? mp.quantityName ?? mp.field ?? mp.source ?? `Metric ${mp.metricId}`)
                                : "";
                            onUpdate({
                                kpiFormulaId: undefined,
                                metric: val,
                                metricPointId: mp?.id,
                                metricId: mp?.metricId,
                                label: entry.label || label,
                            });
                        }
                    }}
                    className="w-full h-6 px-1.5 text-xs bg-background border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                    <option value="">Select metric...</option>
                    {metricPoints.map((mp) => {
                        const label = mp.displayName ?? mp.quantityDisplayName ?? mp.quantityName ?? mp.field ?? mp.source ?? `Metric ${mp.metricId}`;
                        return (
                            <option key={mp.id} value={mp.id}>
                                {label}{mp.unit ? ` (${mp.unit})` : ""}
                            </option>
                        );
                    })}
                    {kpiFormulas.length > 0 && (
                        <optgroup label="Computed KPIs">
                            {kpiFormulas.map((kpi) => (
                                <option key={kpi.id} value={`kpi:${kpi.id}`}>
                                    {kpi.displayName}{kpi.unit ? ` (${kpi.unit})` : ""}
                                </option>
                            ))}
                        </optgroup>
                    )}
                </select>
            ) : (
                <select
                    value={entry.kpiFormulaId ? `kpi:${entry.kpiFormulaId}` : (entry.metric ?? "")}
                    onChange={(e) => {
                        const val = e.target.value;
                        if (val.startsWith("kpi:")) {
                            const kpiId = val.slice(4);
                            const kpi = kpiFormulas.find((k) => k.id === kpiId);
                            onUpdate({
                                kpiFormulaId: kpiId,
                                metric: undefined,
                                metricPointId: undefined,
                                metricId: undefined,
                                label: entry.label || kpi?.displayName || "",
                            });
                        } else {
                            const metricName = val;
                            const readable = metricName
                                ? metricName.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
                                : "";
                            onUpdate({
                                kpiFormulaId: undefined,
                                metric: metricName,
                                label: entry.label || readable,
                            });
                        }
                    }}
                    disabled={metricEntries.length === 0 && kpiFormulas.length === 0}
                    className="w-full h-6 px-1.5 text-xs bg-background border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                >
                    <option value="">{metricEntries.length === 0 && kpiFormulas.length === 0 ? "No metrics" : "Select metric..."}</option>
                    {metricEntries.map(([key, ent]) => (
                        <option key={key} value={ent.name || key}>{ent.name || `Metric ${key}`}</option>
                    ))}
                    {kpiFormulas.length > 0 && (
                        <optgroup label="Computed KPIs">
                            {kpiFormulas.map((kpi) => (
                                <option key={kpi.id} value={`kpi:${kpi.id}`}>
                                    {kpi.displayName}{kpi.unit ? ` (${kpi.unit})` : ""}
                                </option>
                            ))}
                        </optgroup>
                    )}
                </select>
            )}
        </div>
    );
}

// ─── Derived Property data source ──────────────────────────────────────────

const DISPLAY_FORMAT_OPTIONS = [
    { value: "number", label: "Number" },
    { value: "percent", label: "Percent" },
] as const;

function DerivedPropertyDataSource({
    widget,
    scopedObjects,
    onUpdateConfig,
}: {
    widget: DashboardWidget;
    scopedObjects: GraphObject[];
    onUpdateConfig: (widgetId: string, config: Partial<WidgetConfig>) => void;
}) {
    return (
        <SectionWrapper title="Data Source" icon={Database}>
            {/* Object picker — any object in scope can have derived properties */}
            <FieldRow label="Object">
                <select
                    value={widget.config.assetId ?? ""}
                    onChange={(e) => onUpdateConfig(widget.id, { assetId: e.target.value || undefined })}
                    className="flex-1 h-7 px-2 text-xs bg-background border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                    <option value="">Select object...</option>
                    {scopedObjects.map((o) => (
                        <option key={o.id} value={o.id}>
                            {o.displayName} ({o.objectTypeName})
                        </option>
                    ))}
                </select>
            </FieldRow>

            {/* Property name — must match a registered derived property key */}
            <FieldRow label="Property">
                <input
                    value={widget.config.propertyName ?? ""}
                    onChange={(e) => onUpdateConfig(widget.id, { propertyName: e.target.value || undefined })}
                    placeholder="e.g. efficiency_score"
                    className="flex-1 h-7 px-2 text-xs bg-background border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/40"
                />
            </FieldRow>

            {/* Display format */}
            <FieldRow label="Format">
                <select
                    value={widget.config.displayFormat ?? "number"}
                    onChange={(e) =>
                        onUpdateConfig(widget.id, { displayFormat: e.target.value as "number" | "percent" })
                    }
                    className="flex-1 h-7 px-2 text-xs bg-background border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                    {DISPLAY_FORMAT_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                </select>
            </FieldRow>
        </SectionWrapper>
    );
}

// ─── Event Timeline data source ─────────────────────────────────────────────

const SEVERITY_OPTIONS = ["CRITICAL", "ERROR", "WARNING", "INFO", "DEBUG"] as const;

function EventTimelineDataSource({
    widget,
    onUpdateConfig,
}: {
    widget: DashboardWidget;
    onUpdateConfig: (widgetId: string, config: Partial<WidgetConfig>) => void;
}) {
    const severityFilter = widget.config.severityFilter ?? [];

    const handleToggleSeverity = useCallback((severity: string) => {
        const next = severityFilter.includes(severity)
            ? severityFilter.filter((s) => s !== severity)
            : [...severityFilter, severity];
        onUpdateConfig(widget.id, { severityFilter: next.length > 0 ? next : undefined });
    }, [widget.id, severityFilter, onUpdateConfig]);

    return (
        <SectionWrapper title="Data Source" icon={Database}>
            {/* Severity filter — empty means "all severities" */}
            <div className="py-1">
                <span className="text-xs text-muted-foreground block mb-1.5">Severity Filter</span>
                <div className="flex flex-wrap gap-1.5">
                    {SEVERITY_OPTIONS.map((sev) => {
                        const isExplicitlySelected = severityFilter.includes(sev);
                        return (
                            <button
                                key={sev}
                                onClick={() => handleToggleSeverity(sev)}
                                className={cn(
                                    "px-2 py-0.5 rounded text-[10px] font-medium border transition-colors",
                                    isExplicitlySelected
                                        ? "bg-primary text-primary-foreground border-primary"
                                        : severityFilter.length === 0
                                            ? "bg-muted text-muted-foreground border-border"
                                            : "bg-background text-muted-foreground/50 border-border/50 line-through"
                                )}
                            >
                                {sev}
                            </button>
                        );
                    })}
                </div>
                {severityFilter.length === 0 && (
                    <p className="text-[10px] text-muted-foreground/60 mt-1">All severities shown</p>
                )}
            </div>

            {/* Max items */}
            <FieldRow label="Max Items">
                <input
                    type="number"
                    min={1}
                    max={100}
                    value={widget.config.maxItems ?? 10}
                    onChange={(e) =>
                        onUpdateConfig(widget.id, {
                            maxItems: e.target.value ? Math.max(1, Number(e.target.value)) : undefined,
                        })
                    }
                    className="flex-1 h-7 px-2 text-xs bg-background border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder="10"
                />
            </FieldRow>
        </SectionWrapper>
    );
}

// ─── Comparison data source ─────────────────────────────────────────────────

function ComparisonDataSource({
    widget,
    scopedObjects,
    onUpdateConfig,
}: {
    widget: DashboardWidget;
    scopedObjects: GraphObject[];
    onUpdateConfig: (widgetId: string, config: Partial<WidgetConfig>) => void;
}) {
    const objectIds = widget.config.objectIds ?? [];

    const handleAddObject = useCallback(() => {
        onUpdateConfig(widget.id, { objectIds: [...objectIds, ""] });
    }, [widget.id, objectIds, onUpdateConfig]);

    const handleUpdateObject = useCallback((idx: number, value: string) => {
        const next = objectIds.map((id, i) => (i === idx ? value : id));
        onUpdateConfig(widget.id, { objectIds: next });
    }, [widget.id, objectIds, onUpdateConfig]);

    const handleRemoveObject = useCallback((idx: number) => {
        onUpdateConfig(widget.id, { objectIds: objectIds.filter((_, i) => i !== idx) });
    }, [widget.id, objectIds, onUpdateConfig]);

    return (
        <SectionWrapper title="Data Source" icon={Database}>
            {/* Quantity name — the physical quantity to compare across objects */}
            <FieldRow label="Quantity">
                <input
                    value={widget.config.quantityName ?? ""}
                    onChange={(e) => onUpdateConfig(widget.id, { quantityName: e.target.value || undefined })}
                    placeholder="e.g. temperature"
                    className="flex-1 h-7 px-2 text-xs bg-background border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/40"
                />
            </FieldRow>

            {/* Object list */}
            <div className="mt-2">
                <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-muted-foreground">
                        Objects
                        <span className="ml-1 text-[10px] font-normal">{objectIds.length}</span>
                    </span>
                    <button
                        onClick={handleAddObject}
                        className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                        <Plus className="h-3.5 w-3.5" />
                    </button>
                </div>

                <div className="space-y-1">
                    {objectIds.map((id, idx) => (
                        <div key={idx} className="flex items-center gap-1.5">
                            <span className="text-[10px] text-muted-foreground w-4 shrink-0 text-center">
                                {idx + 1}
                            </span>
                            <select
                                value={id}
                                onChange={(e) => handleUpdateObject(idx, e.target.value)}
                                className="flex-1 h-7 px-2 text-xs bg-background border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                            >
                                <option value="">Select object...</option>
                                {scopedObjects.map((o) => (
                                    <option key={o.id} value={o.id}>
                                        {o.displayName} ({o.objectTypeName})
                                    </option>
                                ))}
                            </select>
                            <button
                                onClick={() => handleRemoveObject(idx)}
                                className="p-0.5 rounded text-muted-foreground hover:text-danger transition-colors shrink-0"
                            >
                                <X className="h-3 w-3" />
                            </button>
                        </div>
                    ))}
                    {objectIds.length === 0 && (
                        <p className="text-[10px] text-muted-foreground/60 text-center py-2">
                            No objects selected. Click + to add.
                        </p>
                    )}
                </div>
            </div>
        </SectionWrapper>
    );
}

// ─── Value Transform section (stat_card, gauge) ─────────────────────────

function ValueTransformSection({
    widget,
    onUpdateConfig,
}: {
    widget: DashboardWidget;
    onUpdateConfig: (widgetId: string, config: Partial<WidgetConfig>) => void;
}) {
    const transform = widget.config.valueTransform;

    const update = useCallback(
        (patch: Partial<NonNullable<WidgetConfig["valueTransform"]>>) => {
            const next = { ...transform, ...patch };
            if (next.multiply === undefined) delete next.multiply;
            if (next.offset === undefined) delete next.offset;
            if (next.decimals === undefined) delete next.decimals;
            if (!next.unit) delete next.unit;
            onUpdateConfig(widget.id, {
                valueTransform: Object.keys(next).length > 0 ? next : undefined,
            });
        },
        [widget.id, transform, onUpdateConfig]
    );

    return (
        <SectionWrapper title="Value Transform" icon={ArrowRightLeft}>
            <p className="text-[10px] text-muted-foreground mb-2">
                result = raw × multiply + offset
            </p>
            <FieldRow label="Multiply">
                <input
                    type="number"
                    step="any"
                    value={transform?.multiply ?? ""}
                    placeholder="1"
                    onChange={(e) => update({ multiply: e.target.value ? Number(e.target.value) : undefined })}
                    className="flex-1 h-7 px-2 text-xs bg-background border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
            </FieldRow>
            <FieldRow label="Offset">
                <input
                    type="number"
                    step="any"
                    value={transform?.offset ?? ""}
                    placeholder="0"
                    onChange={(e) => update({ offset: e.target.value ? Number(e.target.value) : undefined })}
                    className="flex-1 h-7 px-2 text-xs bg-background border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
            </FieldRow>
            <FieldRow label="Decimals">
                <input
                    type="number"
                    min={0}
                    max={6}
                    value={transform?.decimals ?? ""}
                    placeholder="1"
                    onChange={(e) => update({ decimals: e.target.value ? Number(e.target.value) : undefined })}
                    className="flex-1 h-7 px-2 text-xs bg-background border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
            </FieldRow>
            <FieldRow label="Unit">
                <input
                    type="text"
                    value={transform?.unit ?? ""}
                    placeholder={widget.config.yAxis?.unit || "—"}
                    onChange={(e) => update({ unit: e.target.value || undefined })}
                    className="flex-1 h-7 px-2 text-xs bg-background border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
            </FieldRow>
        </SectionWrapper>
    );
}

// ─── Display section ────────────────────────────────────────────────────────

function DisplaySection({
    widget,
    onUpdatePosition,
    maxColumns,
}: {
    widget: DashboardWidget;
    onUpdatePosition: (widgetId: string, position: Partial<WidgetPosition>) => void;
    maxColumns: number;
}) {
    return (
        <SectionWrapper title="Display" icon={Monitor}>
            <FieldRow label="Col Span">
                <input
                    type="range"
                    min={1}
                    max={maxColumns}
                    value={widget.position?.colSpan ?? 1}
                    onChange={(e) => onUpdatePosition(widget.id, { colSpan: Number(e.target.value) })}
                    className="flex-1 h-5"
                />
                <span className="text-xs text-foreground font-medium w-6 text-center">
                    {widget.position?.colSpan ?? 1}
                </span>
            </FieldRow>
            <FieldRow label="Row Span">
                <input
                    type="range"
                    min={1}
                    max={8}
                    value={widget.position?.rowSpan ?? 1}
                    onChange={(e) => onUpdatePosition(widget.id, { rowSpan: Number(e.target.value) })}
                    className="flex-1 h-5"
                />
                <span className="text-xs text-foreground font-medium w-6 text-center">
                    {widget.position?.rowSpan ?? 1}
                </span>
            </FieldRow>
        </SectionWrapper>
    );
}

// ─── Shared layout helpers ──────────────────────────────────────────────────

function SectionWrapper({
    title,
    icon: Icon,
    children,
}: {
    title: string;
    icon: React.ElementType;
    children: React.ReactNode;
}) {
    return (
        <div className="px-4 py-3 border-b border-border/50">
            <div className="flex items-center gap-1.5 mb-2">
                <Icon className="h-3 w-3 text-muted-foreground" />
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{title}</p>
            </div>
            {children}
        </div>
    );
}

function FieldRow({
    label,
    children,
}: {
    label: string;
    children: React.ReactNode;
}) {
    return (
        <div className="flex items-center gap-2 py-1">
            <span className="text-xs text-muted-foreground w-16 shrink-0">{label}</span>
            {children}
        </div>
    );
}
