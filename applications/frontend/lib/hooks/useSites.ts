/**
 * SWR Hook for Sites
 * Provides data fetching with automatic caching and revalidation
 */

import useSWR from "swr";
import { listSites, getSite } from "../api/sites";
import type { ListSitesResponse, GetSiteResponse } from "../api/types";

/**
 * Hook to fetch list of sites
 * Supports optional tenantId for scoped queries (system admins / consultants)
 */
export function useSites(page: number = 1, pageSize: number = 100, tenantId?: string) {
    const cacheKey = tenantId
        ? `/sites?page=${page}&pageSize=${pageSize}&tenantId=${tenantId}`
        : `/sites?page=${page}&pageSize=${pageSize}`;

    const { data, error, isLoading, mutate } = useSWR<ListSitesResponse>(
        cacheKey,
        () => listSites(page, pageSize, tenantId),
        {
            revalidateOnFocus: false,
            revalidateOnReconnect: true,
        }
    );

    return {
        sites: data?.sites || [],
        pageInfo: data?.page,
        isLoading,
        isError: error,
        mutate,
    };
}

/**
 * Hook to fetch site details
 */
export function useSite(siteId: string | null) {
    const { data, error, isLoading, mutate } = useSWR<GetSiteResponse>(
        siteId ? `/sites/${siteId}` : null,
        siteId ? () => getSite(siteId) : null,
        {
            revalidateOnFocus: false,
            revalidateOnReconnect: true,
        }
    );

    return {
        site: data?.site,
        assets: data?.assets || [],
        isLoading,
        isError: error,
        mutate,
    };
}
