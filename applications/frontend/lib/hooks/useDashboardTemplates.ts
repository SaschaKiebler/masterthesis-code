"use client";

import useSWR from "swr";
import { useCallback } from "react";
import {
    listDashboardTemplates,
    createDashboardTemplate,
    deleteDashboardTemplate,
    type DashboardTemplateDTO,
} from "@/lib/api/dashboard-templates";

export function useDashboardTemplates() {
    const { data, error, isLoading, mutate } = useSWR(
        "dashboard-templates",
        () => listDashboardTemplates(),
        { revalidateOnFocus: false }
    );

    const create = useCallback(async (name: string, layout: string, tenantId: string) => {
        const res = await createDashboardTemplate({ name, layout, tenantId });
        await mutate();
        return res.dashboardTemplate;
    }, [mutate]);

    const remove = useCallback(async (id: string) => {
        await deleteDashboardTemplate(id);
        await mutate();
    }, [mutate]);

    return {
        templates: data?.dashboardTemplates ?? [] as DashboardTemplateDTO[],
        isLoading,
        isError: !!error,
        mutate,
        create,
        remove,
    };
}
