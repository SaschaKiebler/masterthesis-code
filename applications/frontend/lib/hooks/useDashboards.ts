"use client";

import { useState, useEffect, useCallback } from "react";
import { listDashboards, getDashboard, createDashboard, updateDashboard, deleteDashboard } from "../api/dashboards";
import type { Dashboard, CreateDashboardRequest, UpdateDashboardRequest } from "../api/types";

interface UseDashboardsResult {
    dashboards: Dashboard[];
    loading: boolean;
    error: string | null;
    refresh: () => void;
    create: (data: CreateDashboardRequest) => Promise<Dashboard>;
    update: (id: string, data: UpdateDashboardRequest) => Promise<Dashboard>;
    remove: (id: string) => Promise<void>;
}

export function useDashboards(projectId: string | null): UseDashboardsResult {
    const [dashboards, setDashboards] = useState<Dashboard[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetch = useCallback(async () => {
        if (!projectId) return;
        setLoading(true);
        setError(null);
        try {
            const res = await listDashboards(projectId);
            setDashboards(res.dashboards);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load dashboards");
        } finally {
            setLoading(false);
        }
    }, [projectId]);

    useEffect(() => { fetch(); }, [fetch]);

    const create = useCallback(async (data: CreateDashboardRequest): Promise<Dashboard> => {
        if (!projectId) throw new Error("No project ID");
        const res = await createDashboard(projectId, data);
        await fetch();
        return res.dashboard;
    }, [projectId, fetch]);

    const update = useCallback(async (id: string, data: UpdateDashboardRequest): Promise<Dashboard> => {
        const res = await updateDashboard(id, data);
        await fetch();
        return res.dashboard;
    }, [fetch]);

    const remove = useCallback(async (id: string) => {
        await deleteDashboard(id);
        await fetch();
    }, [fetch]);

    return { dashboards, loading, error, refresh: fetch, create, update, remove };
}

interface UseDashboardResult {
    dashboard: Dashboard | null;
    loading: boolean;
    error: string | null;
    refresh: () => void;
}

export function useDashboard(dashboardId: string | null): UseDashboardResult {
    const [dashboard, setDashboard] = useState<Dashboard | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetch = useCallback(async () => {
        if (!dashboardId) return;
        setLoading(true);
        setError(null);
        try {
            const res = await getDashboard(dashboardId);
            setDashboard(res.dashboard);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load dashboard");
        } finally {
            setLoading(false);
        }
    }, [dashboardId]);

    useEffect(() => { fetch(); }, [fetch]);

    return { dashboard, loading, error, refresh: fetch };
}
