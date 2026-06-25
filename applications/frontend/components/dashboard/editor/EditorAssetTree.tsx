"use client";

/**
 * EditorAssetTree — left panel of the Dashboard Editor.
 * Shows assets from the dashboard's scope context, grouped by category.
 * Device-category items are draggable onto the grid preview.
 * DEVICE-category objects can be expanded to reveal metric point leaves.
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils/cn";
import type { GraphObject } from "@/lib/api/types";
import type { DraggedAsset } from "./useEditorState";
import { getMetricPoints, type MetricPoint } from "@/lib/api/metric-points";
import { getProjectDerivedProperties, type ProjectDerivedProperty } from "@/lib/api/projects";
import {
    Search, ChevronRight, ChevronDown, GripVertical,
    Building2, Layers, Home, DoorOpen, Warehouse, Wrench, Cpu,
    Radio, Router, Flame, Droplets, Gauge, Zap, User, GitBranch, Network,
    Activity, Brain,
} from "lucide-react";

// ─── Icon + colour maps ─────────────────────────────────────────────────────

const ICON_MAP: Record<string, React.ElementType> = {
    BUILDING: Building2, FLOOR: Layers, APARTMENT: Home, ROOM: DoorOpen,
    BASEMENT: Warehouse, COMMON_AREA: Building2, TECHNICAL_ROOM: Wrench,
    HEATING_CIRCUIT: GitBranch, HEATING_ZONE: Network, DISTRIBUTION_NETWORK: Network,
    PERSON: User, GENERIC_SENSOR: Cpu, ACTUATOR: Radio, CONTROLLER: Router,
    GATEWAY: Router, BOILER: Flame, PUMP: Droplets, HEAT_METER: Gauge, ENERGY_METER: Zap,
    WATER_METER: Droplets, TEMPERATURE_SENSOR: Gauge, VALVE_ACTUATOR: Radio,
};

const CATEGORY_ICON: Record<string, React.ElementType> = {
    STRUCTURE: Building2, SPACE: Layers, DEVICE: Cpu, SYSTEM: GitBranch, CONTACT: User,
};

const CATEGORY_COLOR: Record<string, string> = {
    STRUCTURE: "text-blue-500", SPACE: "text-emerald-500", DEVICE: "text-amber-500",
    SYSTEM: "text-purple-500", CONTACT: "text-pink-500",
};

const DRAGGABLE_CATEGORIES = new Set([
    "SENSOR", "ACTUATOR", "CONTROLLER", "GATEWAY", "DEVICE", "METER",
    "SYSTEM",
]);

// Categories whose objects support metric point expansion
const METRIC_EXPANDABLE_CATEGORIES = new Set([
    "SENSOR", "ACTUATOR", "CONTROLLER", "GATEWAY", "DEVICE", "METER",
]);

const CATEGORY_ORDER = ["STRUCTURE", "SPACE", "DEVICE", "SYSTEM", "CONTACT"];

// ─── Props ──────────────────────────────────────────────────────────────────

const QUALITY_DOT: Record<string, string> = {
    GOOD:              "bg-emerald-500",
    STALE:             "bg-amber-500",
    LOW_CONFIDENCE:    "bg-orange-500",
    INSUFFICIENT_DATA: "bg-muted-foreground/40",
};

interface EditorAssetTreeProps {
    objects: GraphObject[];
    projectId?: string;
    scopeLabel?: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function EditorAssetTree({ objects, projectId, scopeLabel }: EditorAssetTreeProps) {
    const [search, setSearch] = useState("");
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

    // Computed KPIs state
    const [derivedProps, setDerivedProps] = useState<ProjectDerivedProperty[]>([]);
    const [kpisCollapsed, setKpisCollapsed] = useState(false);

    useEffect(() => {
        if (!projectId) return;
        getProjectDerivedProperties(projectId)
            .then((r) => setDerivedProps(r.derivedProperties))
            .catch(() => {});
    }, [projectId]);

    // Per-object metric expansion state
    const [expandedObjects, setExpandedObjects] = useState<Record<string, boolean>>({});
    // Cache of fetched metric points keyed by objectId
    const [metricPointCache, setMetricPointCache] = useState<Record<string, MetricPoint[]>>({});
    // Track which objects are currently loading their metric points
    const [loadingMetrics, setLoadingMetrics] = useState<Record<string, boolean>>({});

    const filtered = useMemo(() => {
        if (!search.trim()) return objects;
        const q = search.toLowerCase();
        return objects.filter(
            (o) =>
                o.displayName.toLowerCase().includes(q) ||
                o.objectTypeName.toLowerCase().includes(q)
        );
    }, [objects, search]);

    const groups = useMemo(() => {
        const map = new Map<string, GraphObject[]>();
        for (const obj of filtered) {
            const cat = obj.objectTypeCategory || "DEVICE";
            if (!map.has(cat)) map.set(cat, []);
            map.get(cat)!.push(obj);
        }
        for (const arr of map.values()) {
            arr.sort((a, b) => a.displayName.localeCompare(b.displayName));
        }
        const result: { category: string; label: string; objects: GraphObject[] }[] = [];
        for (const cat of CATEGORY_ORDER) {
            if (map.has(cat)) {
                result.push({ category: cat, label: cat.charAt(0) + cat.slice(1).toLowerCase(), objects: map.get(cat)! });
                map.delete(cat);
            }
        }
        for (const [cat, objs] of map) {
            result.push({ category: cat, label: cat.charAt(0) + cat.slice(1).toLowerCase(), objects: objs });
        }
        return result;
    }, [filtered]);

    const toggleGroup = useCallback((category: string) => {
        setCollapsed((prev) => ({ ...prev, [category]: !prev[category] }));
    }, []);

    // Toggle metric point expansion for a specific object, fetching on first open
    const toggleObjectMetrics = useCallback((obj: GraphObject) => {
        const objectId = obj.id;
        const isExpanded = expandedObjects[objectId] ?? false;

        if (!isExpanded && !(objectId in metricPointCache)) {
            // Fetch metric points on first expand
            setLoadingMetrics((prev) => ({ ...prev, [objectId]: true }));
            getMetricPoints(objectId)
                .then((points) => {
                    setMetricPointCache((prev) => ({ ...prev, [objectId]: points }));
                })
                .catch(() => {
                    // Silently fail — show empty state
                    setMetricPointCache((prev) => ({ ...prev, [objectId]: [] }));
                })
                .finally(() => {
                    setLoadingMetrics((prev) => ({ ...prev, [objectId]: false }));
                });
        }

        setExpandedObjects((prev) => ({ ...prev, [objectId]: !isExpanded }));
    }, [expandedObjects, metricPointCache]);

    const handleDragStart = useCallback((e: React.DragEvent, obj: GraphObject) => {
        const data: DraggedAsset = {
            objectId: obj.id,
            objectTypeName: obj.objectTypeName,
            displayName: obj.displayName,
        };
        e.dataTransfer.setData("application/json", JSON.stringify(data));
        e.dataTransfer.effectAllowed = "copy";
    }, []);

    const handleMetricDragStart = useCallback(
        (e: React.DragEvent, obj: GraphObject, mp: MetricPoint) => {
            const metricDisplayName =
                mp.quantityDisplayName ?? mp.quantityName ?? mp.field ?? `Metric ${mp.metricId}`;
            const data: DraggedAsset = {
                objectId: obj.id,
                objectTypeName: obj.objectTypeName,
                displayName: obj.displayName,
                metricPointId: mp.id,
                metricDisplayName,
                metricUnit: mp.unit,
                metricDimension: mp.dimension,
            };
            e.dataTransfer.setData("application/json", JSON.stringify(data));
            e.dataTransfer.effectAllowed = "copy";
        },
        []
    );

    const handleDerivedPropDragStart = useCallback(
        (e: React.DragEvent, prop: ProjectDerivedProperty) => {
            const data: DraggedAsset = {
                objectId: prop.objectId,
                objectTypeName: prop.objectTypeName,
                displayName: prop.displayName,
                dragType: "derived_property",
                propertyName: prop.propertyName,
                metricUnit: prop.unit ?? undefined,
            };
            e.dataTransfer.setData("application/json", JSON.stringify(data));
            e.dataTransfer.effectAllowed = "copy";
        },
        []
    );

    const isDraggable = (obj: GraphObject) =>
        DRAGGABLE_CATEGORIES.has(obj.objectTypeCategory);

    const isMetricExpandable = (obj: GraphObject) =>
        METRIC_EXPANDABLE_CATEGORIES.has(obj.objectTypeCategory);

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* Header */}
            <div className="p-3 border-b border-border shrink-0 space-y-2">
                <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Assets</span>
                    {scopeLabel && (
                        <span className="text-[10px] text-muted-foreground/60 truncate ml-2">{scopeLabel}</span>
                    )}
                </div>
                <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                    <input
                        type="text"
                        placeholder="Search assets..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full h-8 pl-8 pr-3 text-sm bg-background border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                </div>
                <p className="text-[10px] text-muted-foreground">
                    Drag devices onto the dashboard grid
                </p>
            </div>

            {/* Tree */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden py-1">
                {groups.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-6">
                        {search ? "No assets match your search." : "No assets in scope."}
                    </p>
                )}

                {groups.map((group) => {
                    const isCollapsed = collapsed[group.category] ?? false;
                    const CatIcon = CATEGORY_ICON[group.category] ?? Cpu;
                    const catColor = CATEGORY_COLOR[group.category] ?? "text-muted-foreground";

                    return (
                        <div key={group.category}>
                            <button
                                onClick={() => toggleGroup(group.category)}
                                className="flex items-center gap-1.5 w-full px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
                            >
                                {isCollapsed ? (
                                    <ChevronRight className="h-3 w-3 shrink-0" />
                                ) : (
                                    <ChevronDown className="h-3 w-3 shrink-0" />
                                )}
                                <CatIcon className={cn("h-3.5 w-3.5 shrink-0", catColor)} />
                                <span className="flex-1 text-left">{group.label}</span>
                                <span className="text-[10px] font-normal tabular-nums">{group.objects.length}</span>
                            </button>

                            {!isCollapsed && (
                                <div className="pb-1">
                                    {group.objects.map((obj) => {
                                        const Icon = ICON_MAP[obj.objectTypeName] ?? Cpu;
                                        const iconColor = CATEGORY_COLOR[obj.objectTypeCategory] ?? "text-muted-foreground";
                                        const canDrag = isDraggable(obj);
                                        const canExpand = isMetricExpandable(obj);
                                        const isObjectExpanded = expandedObjects[obj.id] ?? false;
                                        const isLoadingMp = loadingMetrics[obj.id] ?? false;
                                        const cachedPoints = metricPointCache[obj.id];

                                        return (
                                            <div key={obj.id}>
                                                {/* Device row */}
                                                <div
                                                    draggable={canDrag}
                                                    onDragStart={canDrag ? (e) => handleDragStart(e, obj) : undefined}
                                                    className={cn(
                                                        "flex items-center gap-1.5 w-full px-3 pl-8 py-1.5 text-sm transition-colors",
                                                        canDrag
                                                            ? "cursor-grab active:cursor-grabbing hover:bg-primary/5 hover:text-foreground text-muted-foreground"
                                                            : "text-muted-foreground/50"
                                                    )}
                                                >
                                                    {canDrag && (
                                                        <GripVertical className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                                                    )}
                                                    <Icon className={cn("h-3.5 w-3.5 shrink-0", iconColor)} />
                                                    <span className="truncate flex-1">{obj.displayName}</span>

                                                    {/* Expand toggle for metric points */}
                                                    {canExpand && (
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                toggleObjectMetrics(obj);
                                                            }}
                                                            className={cn(
                                                                "p-0.5 rounded transition-colors shrink-0",
                                                                isObjectExpanded
                                                                    ? "text-primary hover:text-primary/80"
                                                                    : "text-muted-foreground/40 hover:text-muted-foreground"
                                                            )}
                                                            title={isObjectExpanded ? "Collapse metrics" : "Expand metrics"}
                                                        >
                                                            {isObjectExpanded ? (
                                                                <ChevronDown className="h-3 w-3" />
                                                            ) : (
                                                                <ChevronRight className="h-3 w-3" />
                                                            )}
                                                        </button>
                                                    )}
                                                </div>

                                                {/* Metric point leaves */}
                                                {canExpand && isObjectExpanded && (
                                                    <div className="pl-12 pb-0.5">
                                                        {isLoadingMp ? (
                                                            <p className="text-[10px] text-muted-foreground/50 py-1 pl-2">
                                                                Loading metrics...
                                                            </p>
                                                        ) : !cachedPoints || cachedPoints.length === 0 ? (
                                                            <p className="text-[10px] text-muted-foreground/40 py-1 pl-2">
                                                                No metric points registered
                                                            </p>
                                                        ) : (
                                                            cachedPoints.map((mp) => {
                                                                const metricLabel =
                                                                    mp.quantityDisplayName ??
                                                                    mp.quantityName ??
                                                                    mp.field ??
                                                                    `Metric ${mp.metricId}`;
                                                                return (
                                                                    <div
                                                                        key={mp.id}
                                                                        draggable
                                                                        onDragStart={(e) => handleMetricDragStart(e, obj, mp)}
                                                                        className="flex items-center gap-1.5 py-1 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-primary/5 rounded cursor-grab active:cursor-grabbing transition-colors"
                                                                    >
                                                                        <GripVertical className="h-2.5 w-2.5 text-muted-foreground/30 shrink-0" />
                                                                        <Activity className="h-3 w-3 text-primary/50 shrink-0" />
                                                                        <span className="truncate flex-1">{metricLabel}</span>
                                                                        {mp.unit && (
                                                                            <span className="text-[10px] text-muted-foreground/50 shrink-0 font-mono">
                                                                                {mp.unit}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                );
                                                            })
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })}

                {/* Computed KPIs section */}
                {projectId && derivedProps.length > 0 && (
                    <div className="mt-1 border-t border-border/50 pt-1">
                        <button
                            onClick={() => setKpisCollapsed((v) => !v)}
                            className="flex items-center gap-1.5 w-full px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
                        >
                            {kpisCollapsed ? (
                                <ChevronRight className="h-3 w-3 shrink-0" />
                            ) : (
                                <ChevronDown className="h-3 w-3 shrink-0" />
                            )}
                            <Brain className="h-3.5 w-3.5 shrink-0 text-violet-500" />
                            <span className="flex-1 text-left">Computed KPIs</span>
                            <span className="text-[10px] font-normal tabular-nums">{derivedProps.length}</span>
                        </button>

                        {!kpisCollapsed && (
                            <div className="pb-1">
                                {derivedProps.map((prop) => {
                                    const qualityDot = QUALITY_DOT[prop.quality ?? "INSUFFICIENT_DATA"] ?? QUALITY_DOT.INSUFFICIENT_DATA;
                                    const valueStr = prop.valueNumeric != null
                                        ? `${Number(prop.valueNumeric.toPrecision(4))}${prop.unit ? " " + prop.unit : ""}`
                                        : prop.valueText ?? "—";
                                    return (
                                        <div
                                            key={prop.id}
                                            draggable
                                            onDragStart={(e) => handleDerivedPropDragStart(e, prop)}
                                            className="flex items-center gap-1.5 w-full px-3 pl-8 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-primary/5 cursor-grab active:cursor-grabbing transition-colors"
                                        >
                                            <GripVertical className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                                            <div className={`h-2 w-2 rounded-full shrink-0 ${qualityDot}`} />
                                            <span className="truncate flex-1 text-xs">{prop.displayName}</span>
                                            <span className="text-[10px] text-muted-foreground/60 font-mono shrink-0">
                                                {valueStr}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="border-t border-border px-3 py-2 shrink-0">
                <p className="text-[10px] text-muted-foreground">
                    {objects.length} object{objects.length !== 1 ? "s" : ""} in scope
                </p>
            </div>
        </div>
    );
}
