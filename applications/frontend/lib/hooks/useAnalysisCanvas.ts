"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import useSWR from "swr";
import { getProjectMetricPoints, getProjectMeasurements } from "@/lib/api/projects";
import {
    listAnalysisViews,
    createAnalysisView,
    updateAnalysisView,
    deleteAnalysisView,
    createEmptyCanvas,
} from "@/lib/api/analysis";
import type { CanvasDefinition } from "@/lib/api/analysis";
import type { TimeRange, Measurement } from "@/lib/api/types";
import type { ProjectMetricPoint } from "@/lib/api/projects";
import type { AnalysisView } from "@/lib/api/analysis";

function getPresetTimeRange(preset: string): TimeRange {
    const now = Math.floor(Date.now() / 1000);
    switch (preset) {
        case "24h": return { from: now - 86400, to: now };
        case "3d": return { from: now - 259200, to: now };
        case "7d": return { from: now - 604800, to: now };
        case "30d": return { from: now - 2592000, to: now };
        case "Season": {
            const d = new Date();
            const year = d.getMonth() < 9 ? d.getFullYear() - 1 : d.getFullYear();
            return { from: new Date(year, 9, 1).getTime() / 1000, to: now };
        }
        default: return { from: now - 86400, to: now };
    }
}

export function useAnalysisCanvas(projectId: string) {
    const [canvas, setCanvas] = useState<CanvasDefinition>(createEmptyCanvas());
    const [activeViewId, setActiveViewId] = useState<string | null>(null);
    const [viewName, setViewName] = useState("Untitled Analysis");
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);
    const [timePreset, setTimePreset] = useState("7d");
    const [customRange, setCustomRange] = useState<TimeRange | null>(null);
    const [compareRange, setCompareRange] = useState<TimeRange | null>(null);
    const [bucketMinutes, setBucketMinutes] = useState<number | null>(null); // null = auto

    const timeRange = useMemo(() => {
        if (timePreset === "custom" && customRange) return customRange;
        return getPresetTimeRange(timePreset);
    }, [timePreset, customRange]);

    // ─── Metric Points ──────────────────────────────────────────────────────

    const { data: mpData } = useSWR(
        projectId ? ["project-metric-points", projectId] : null,
        () => getProjectMetricPoints(projectId),
        { revalidateOnFocus: false }
    );
    const metricPoints: ProjectMetricPoint[] = mpData?.metricPoints ?? [];

    // ─── Measurements (primary range) ───────────────────────────────────────

    const activeMetricPointIds = useMemo(() => {
        const ids = new Set<string>();
        for (const chart of canvas.charts) {
            for (const src of chart.sources) {
                if (src.metricPointId) ids.add(src.metricPointId);
            }
        }
        return Array.from(ids).sort();
    }, [canvas]);

    const idsKey = activeMetricPointIds.join(",");

    const { data: measData, isLoading: measLoading } = useSWR(
        idsKey && timeRange
            ? ["analysis-measurements", projectId, idsKey, timeRange.from, timeRange.to, bucketMinutes]
            : null,
        () => getProjectMeasurements(projectId, {
            metricPointIds: idsKey,
            from: timeRange.from,
            to: timeRange.to,
            ...(bucketMinutes !== null ? { bucket: bucketMinutes } : {}),
        }),
        { revalidateOnFocus: false, keepPreviousData: true }
    );
    const measurements: Measurement[] = measData?.measurements ?? [];

    // ─── Compare Measurements (secondary range) ─────────────────────────────

    const { data: compareMeasData } = useSWR(
        idsKey && compareRange
            ? ["analysis-compare", projectId, idsKey, compareRange.from, compareRange.to, bucketMinutes]
            : null,
        () => getProjectMeasurements(projectId, {
            metricPointIds: idsKey,
            from: compareRange!.from,
            to: compareRange!.to,
            ...(bucketMinutes !== null ? { bucket: bucketMinutes } : {}),
        }),
        { revalidateOnFocus: false, keepPreviousData: true }
    );
    const compareMeasurements: Measurement[] = compareMeasData?.measurements ?? [];

    // ─── Saved Views ────────────────────────────────────────────────────────

    const { data: viewsData, mutate: mutateViews } = useSWR(
        projectId ? ["analysis-views", projectId] : null,
        () => listAnalysisViews(projectId),
        { revalidateOnFocus: false }
    );
    const savedViews: AnalysisView[] = viewsData?.analysisViews ?? [];

    // ─── Auto-load first saved view on initial load ─────────────────────────

    const restoreView = useCallback((view: AnalysisView) => {
        try {
            const def = JSON.parse(view.definition) as CanvasDefinition;
            setCanvas(def);
            setActiveViewId(view.id);
            setViewName(view.name);
            setDirty(false);
            // Restore time settings
            if (def.timeRange?.preset) {
                setTimePreset(def.timeRange.preset);
                if (def.timeRange.preset === "custom" && def.timeRange.customFrom && def.timeRange.customTo) {
                    setCustomRange({ from: def.timeRange.customFrom, to: def.timeRange.customTo });
                }
            }
            if (def.bucketMinutes !== undefined) {
                setBucketMinutes(def.bucketMinutes);
            }
        } catch {
            // ignore parse errors
        }
    }, []);

    const autoLoaded = useRef(false);
    useEffect(() => {
        if (autoLoaded.current || activeViewId) return;
        if (savedViews.length > 0) {
            autoLoaded.current = true;
            restoreView(savedViews[0]);
        }
    }, [savedViews, activeViewId, restoreView]);

    // ─── Actions ────────────────────────────────────────────────────────────

    const updateCanvas = useCallback((newCanvas: CanvasDefinition) => {
        setCanvas(newCanvas);
        setDirty(true);
    }, []);

    const handleTimePresetChange = useCallback((preset: string) => {
        setTimePreset(preset);
        setDirty(true);
    }, []);

    const handleCustomRangeChange = useCallback((range: TimeRange) => {
        setCustomRange(range);
        setTimePreset("custom");
        setDirty(true);
    }, []);

    const save = useCallback(async () => {
        setSaving(true);
        // Persist time settings into canvas definition
        const definitionToSave: CanvasDefinition = {
            ...canvas,
            timeRange: {
                preset: timePreset,
                ...(timePreset === "custom" && customRange ? { customFrom: customRange.from, customTo: customRange.to } : {}),
            },
            bucketMinutes,
        };
        try {
            if (activeViewId) {
                await updateAnalysisView(activeViewId, { name: viewName, definition: definitionToSave });
            } else {
                const resp = await createAnalysisView(projectId, { name: viewName, definition: definitionToSave });
                setActiveViewId(resp.analysisView.id);
            }
            setDirty(false);
            mutateViews();
        } catch (e) {
            console.error("Failed to save analysis view:", e);
        } finally {
            setSaving(false);
        }
    }, [activeViewId, viewName, canvas, projectId, mutateViews, timePreset, customRange, bucketMinutes]);

    const loadView = restoreView;

    const newAnalysis = useCallback(() => {
        setCanvas(createEmptyCanvas());
        setActiveViewId(null);
        setViewName("Untitled Analysis");
        setDirty(false);
        setTimePreset("7d");
        setCustomRange(null);
        setBucketMinutes(null);
    }, []);

    const deleteView = useCallback(async () => {
        if (!activeViewId) return;
        try {
            await deleteAnalysisView(activeViewId);
            setCanvas(createEmptyCanvas());
            setActiveViewId(null);
            setViewName("Untitled Analysis");
            setDirty(false);
            mutateViews();
        } catch (e) {
            console.error("Failed to delete analysis view:", e);
        }
    }, [activeViewId, mutateViews]);

    const renameView = useCallback((name: string) => {
        setViewName(name);
        setDirty(true);
    }, []);

    return {
        canvas,
        updateCanvas,
        metricPoints,
        metricPointsLoaded: !!mpData,
        measurements,
        measLoading,
        timePreset,
        setTimePreset: handleTimePresetChange,
        timeRange,
        customRange,
        setCustomRange: handleCustomRangeChange,
        compareRange,
        setCompareRange,
        compareMeasurements,
        bucketMinutes,
        setBucketMinutes: (v: number | null) => { setBucketMinutes(v); setDirty(true); },
        activeViewId,
        viewName,
        renameView,
        dirty,
        saving,
        savedViews,
        save,
        loadView,
        newAnalysis,
        deleteView,
    };
}
