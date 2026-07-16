"use client";

/**
 * useEditorState — shared state for the Dashboard Editor.
 * Manages layout, widget selection, dirty tracking, and scope resolution.
 */

import { randomUUID } from "@/lib/utils/uuid";
import { useState, useCallback, useMemo, useEffect } from "react";
import type {
    DashboardLayout,
    DashboardWidget,
    WidgetPosition,
    WidgetConfig,
    GraphObject,
    GraphLink,
    Dashboard,
} from "@/lib/api/types";

export interface DraggedAsset {
    objectId: string;
    objectTypeName: string;
    displayName: string;
    // ADR-013: optional metric point pre-fill on drop
    metricPointId?: string;
    metricDisplayName?: string;
    metricUnit?: string;
    metricDimension?: string;
    // KPI Formula drag: derived_property widget
    dragType?: "metric_point" | "derived_property";
    propertyName?: string;  // for derived_property drag type
}

const WIDGET_TYPES = [
    "time_series", "gauge", "status", "stat_card",
    "derived_property", "event_timeline", "comparison", "event_log",
] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

interface UseEditorStateOptions {
    dashboard: Dashboard | null;
    objects: GraphObject[];
    links: GraphLink[];
}

export function useEditorState({ dashboard, objects, links }: UseEditorStateOptions) {
    const [layout, setLayout] = useState<DashboardLayout>({ columns: 2, widgets: [] });
    const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);
    const [dirty, setDirty] = useState(false);

    // Parse layout from dashboard on load
    useEffect(() => {
        if (!dashboard) return;
        try {
            const parsed = JSON.parse(dashboard.layout);
            setLayout(parsed);
            setDirty(false);
        } catch {
            setLayout({ columns: 2, widgets: [] });
        }
    }, [dashboard]);

    // Scope resolution: get objects in scope based on dashboard scope
    const scopedObjects = useMemo(() => {
        if (!dashboard?.scopeId) return objects;
        return getDescendantObjects(dashboard.scopeId, objects, links);
    }, [dashboard?.scopeId, objects, links]);

    const selectedWidget = useMemo(
        () => layout.widgets.find((w) => w.id === selectedWidgetId) ?? null,
        [layout.widgets, selectedWidgetId]
    );

    // ─── Layout mutations ────────────────────────────────────────────────────

    const setColumns = useCallback((columns: number) => {
        setLayout((prev) => ({ ...prev, columns }));
        setDirty(true);
    }, []);

    const addWidget = useCallback((asset: DraggedAsset, col: number) => {
        const id = randomUUID();
        const nextRow = layout.widgets.length > 0
            ? Math.max(...layout.widgets.map((w) => w.position.row + w.position.rowSpan))
            : 0;

        // Determine widget type and config from drag source
        let widgetType: DashboardWidget["type"] = "stat_card";
        let config: WidgetConfig;

        if (asset.dragType === "derived_property" && asset.propertyName) {
            widgetType = "derived_property";
            config = {
                assetId: asset.objectId,
                propertyName: asset.propertyName,
                displayFormat: "number",
            };
        } else if (asset.metricPointId) {
            // ADR-013: metric point drag — pre-fill stable reference
            config = {
                metricPointId: asset.metricPointId,
                title: asset.metricDisplayName ?? asset.displayName,
                yAxis: { unit: asset.metricUnit },
            };
        } else {
            config = { assetId: asset.objectId, title: asset.displayName };
        }

        const newWidget: DashboardWidget = {
            id,
            type: widgetType,
            title: asset.metricDisplayName ?? asset.displayName,
            position: { row: nextRow, col, rowSpan: 2, colSpan: 2 },
            config,
        };

        setLayout((prev) => ({
            ...prev,
            widgets: [...prev.widgets, newWidget],
        }));
        setSelectedWidgetId(id);
        setDirty(true);
    }, [layout.widgets]);

    const WIDGET_DEFAULT_TITLES: Record<WidgetType, string> = {
        time_series: "Untitled Time Series",
        gauge: "Untitled Gauge",
        status: "Untitled Status",
        stat_card: "Untitled Stat Card",
        derived_property: "Untitled KPI",
        event_timeline: "Untitled Timeline",
        comparison: "Untitled Comparison",
        event_log: "Untitled Event Log",
    };

    const addWidgetByType = useCallback((type: WidgetType) => {
        const id = randomUUID();
        const nextRow = layout.widgets.length > 0
            ? Math.max(...layout.widgets.map((w) => w.position.row + w.position.rowSpan))
            : 0;

        const newWidget: DashboardWidget = {
            id,
            type,
            title: WIDGET_DEFAULT_TITLES[type],
            position: { row: nextRow, col: 0, rowSpan: 2, colSpan: 2 },
            config: {},
        };

        setLayout((prev) => ({
            ...prev,
            widgets: [...prev.widgets, newWidget],
        }));
        setSelectedWidgetId(id);
        setDirty(true);
    }, [layout.widgets]);

    const updateWidget = useCallback((widgetId: string, updates: Partial<DashboardWidget>) => {
        setLayout((prev) => ({
            ...prev,
            widgets: prev.widgets.map((w) =>
                w.id === widgetId ? { ...w, ...updates } : w
            ),
        }));
        setDirty(true);
    }, []);

    const updateWidgetConfig = useCallback((widgetId: string, configUpdates: Partial<WidgetConfig>) => {
        setLayout((prev) => ({
            ...prev,
            widgets: prev.widgets.map((w) =>
                w.id === widgetId ? { ...w, config: { ...w.config, ...configUpdates } } : w
            ),
        }));
        setDirty(true);
    }, []);

    const updateWidgetPosition = useCallback((widgetId: string, position: Partial<WidgetPosition>) => {
        setLayout((prev) => ({
            ...prev,
            widgets: prev.widgets.map((w) =>
                w.id === widgetId ? { ...w, position: { ...w.position, ...position } } : w
            ),
        }));
        setDirty(true);
    }, []);

    const removeWidget = useCallback((widgetId: string) => {
        setLayout((prev) => ({
            ...prev,
            widgets: prev.widgets.filter((w) => w.id !== widgetId),
        }));
        if (selectedWidgetId === widgetId) setSelectedWidgetId(null);
        setDirty(true);
    }, [selectedWidgetId]);

    const duplicateWidget = useCallback((widgetId: string) => {
        const source = layout.widgets.find((w) => w.id === widgetId);
        if (!source) return;
        const id = randomUUID();
        const nextRow = Math.max(...layout.widgets.map((w) => w.position.row + w.position.rowSpan));
        const clone: DashboardWidget = {
            ...source,
            id,
            title: `${source.title} (copy)`,
            position: { ...source.position, row: nextRow },
        };
        setLayout((prev) => ({
            ...prev,
            widgets: [...prev.widgets, clone],
        }));
        setSelectedWidgetId(id);
        setDirty(true);
    }, [layout.widgets]);

    const moveWidget = useCallback((widgetId: string, direction: "up" | "down") => {
        setLayout((prev) => {
            const idx = prev.widgets.findIndex((w) => w.id === widgetId);
            if (idx < 0) return prev;
            const swapIdx = direction === "up" ? idx - 1 : idx + 1;
            if (swapIdx < 0 || swapIdx >= prev.widgets.length) return prev;
            const newWidgets = [...prev.widgets];
            [newWidgets[idx], newWidgets[swapIdx]] = [newWidgets[swapIdx], newWidgets[idx]];
            return { ...prev, widgets: newWidgets };
        });
        setDirty(true);
    }, []);

    const resetLayout = useCallback(() => {
        if (!dashboard) return;
        try {
            setLayout(JSON.parse(dashboard.layout));
        } catch {
            setLayout({ columns: 2, widgets: [] });
        }
        setDirty(false);
        setSelectedWidgetId(null);
    }, [dashboard]);

    const applyTemplate = useCallback((newLayout: DashboardLayout) => {
        setLayout(newLayout);
        setSelectedWidgetId(null);
        setDirty(true);
    }, []);

    return {
        layout,
        setLayout,
        dirty,
        setDirty,
        selectedWidgetId,
        setSelectedWidgetId,
        selectedWidget,
        scopedObjects,
        setColumns,
        addWidget,
        addWidgetByType,
        updateWidget,
        updateWidgetConfig,
        updateWidgetPosition,
        removeWidget,
        duplicateWidget,
        moveWidget,
        resetLayout,
        applyTemplate,
    };
}

// ─── Scope resolution ────────────────────────────────────────────────────────

function getDescendantObjects(
    rootId: string,
    objects: GraphObject[],
    links: GraphLink[]
): GraphObject[] {
    const visited = new Set<string>();
    const queue = [rootId];

    while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);
        for (const link of links) {
            if (link.sourceId === current && !visited.has(link.targetId)) {
                queue.push(link.targetId);
            }
        }
    }

    return objects.filter((o) => visited.has(o.id));
}
