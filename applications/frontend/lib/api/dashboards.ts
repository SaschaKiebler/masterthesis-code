import { apiFetch } from "./client";
import type {
    Dashboard,
    CreateDashboardRequest,
    UpdateDashboardRequest,
    ListDashboardsResponse,
    GetDashboardResponse
} from "./types";

/**
 * List all dashboards for a project
 */
export async function listDashboards(projectId: string): Promise<ListDashboardsResponse> {
    return apiFetch<ListDashboardsResponse>(`/projects/${projectId}/dashboards`);
}

/**
 * Get a specific dashboard by ID
 */
export async function getDashboard(dashboardId: string): Promise<GetDashboardResponse> {
    return apiFetch<GetDashboardResponse>(`/dashboards/${dashboardId}`);
}

/**
 * Create a new dashboard
 */
export async function createDashboard(
    projectId: string,
    data: CreateDashboardRequest
): Promise<GetDashboardResponse> {
    return apiFetch<GetDashboardResponse>(`/projects/${projectId}/dashboards`, {
        method: "POST",
        body: JSON.stringify(data),
    });
}

/**
 * Update an existing dashboard
 */
export async function updateDashboard(
    dashboardId: string,
    data: UpdateDashboardRequest
): Promise<GetDashboardResponse> {
    return apiFetch<GetDashboardResponse>(`/dashboards/${dashboardId}`, {
        method: "PATCH",
        body: JSON.stringify(data),
    });
}

/**
 * Delete a dashboard
 */
export async function deleteDashboard(dashboardId: string): Promise<void> {
    return apiFetch(`/dashboards/${dashboardId}`, {
        method: "DELETE",
    });
}
