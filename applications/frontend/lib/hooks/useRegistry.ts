/**
 * SWR hooks for the Ontology Registry (ADR-007)
 * Provides data fetching and cache invalidation for object types and device templates.
 */

import useSWR from "swr";
import { listObjectTypes, listDeviceTemplates } from "@/lib/api/registry";
import type { ObjectType, DeviceTemplate } from "@/lib/api/types";

/**
 * Fetch all active object types with mutate for cache invalidation
 */
export function useObjectTypes() {
    const { data, error, isLoading, mutate } = useSWR(
        "object-types",
        () => listObjectTypes(),
        { revalidateOnFocus: false }
    );

    return {
        objectTypes: data?.objectTypes ?? [],
        isLoading,
        isError: !!error,
        mutate,
    };
}

/**
 * Fetch all active device templates with mutate for cache invalidation
 */
export function useDeviceTemplates() {
    const { data, error, isLoading, mutate } = useSWR(
        "device-templates",
        () => listDeviceTemplates(),
        { revalidateOnFocus: false }
    );

    return {
        templates: data?.deviceTemplates ?? [],
        isLoading,
        isError: !!error,
        mutate,
    };
}
