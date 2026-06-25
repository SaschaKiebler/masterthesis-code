/**
 * SWR hook for event templates (ADR-013 Log Event)
 */

import useSWR from "swr";
import { getEventTemplates } from "@/lib/api/events";

export function useEventTemplates() {
    const { data, error, isLoading, mutate } = useSWR(
        "event-templates",
        () => getEventTemplates(),
        { revalidateOnFocus: false }
    );

    return {
        templates: data ?? [],
        isLoading,
        isError: !!error,
        mutate,
    };
}
