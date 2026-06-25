import { apiFetch } from "./client";

export interface DashboardTemplateDTO {
    id: string;
    tenantId: string;
    name: string;
    layout: string; // JSON string
    createdAt: string;
}

export interface ListDashboardTemplatesResponse {
    dashboardTemplates: DashboardTemplateDTO[];
}

export async function listDashboardTemplates(): Promise<ListDashboardTemplatesResponse> {
    return apiFetch<ListDashboardTemplatesResponse>("/dashboard-templates");
}

export async function createDashboardTemplate(data: {
    name: string;
    layout: string;
    tenantId: string;
}): Promise<{ dashboardTemplate: DashboardTemplateDTO }> {
    return apiFetch("/dashboard-templates", {
        method: "POST",
        body: JSON.stringify(data),
    });
}

export async function deleteDashboardTemplate(id: string): Promise<void> {
    return apiFetch(`/dashboard-templates/${id}`, { method: "DELETE" });
}
