/**
 * SWR hooks for Space management
 */

import useSWR from "swr";
import { listSpaces, createSpace, updateSpace, deleteSpace } from "@/lib/api/spaces";
import type { SpaceDTO, SpacesResponse, CreateSpaceRequest, UpdateSpaceRequest } from "@/lib/api/types";

/**
 * Fetch space tree for a site
 */
export function useSpaces(siteId: string | null, view: "tree" | "flat" = "tree") {
    const { data, error, isLoading, mutate } = useSWR<SpacesResponse>(
        siteId ? `spaces-${siteId}-${view}` : null,
        siteId ? () => listSpaces(siteId, view) : null,
        { revalidateOnFocus: false }
    );

    return {
        spaces: data?.spaces ?? [],
        isLoading,
        isError: !!error,
        mutate,
    };
}

/**
 * Helper: flatten a space tree into a flat list with depth info
 */
export interface FlatSpaceNode {
    space: SpaceDTO;
    depth: number;
    path: string; // e.g. "Ground Floor > Apt 1A > Living Room"
}

export function flattenSpaceTree(spaces: SpaceDTO[], depth = 0, parentPath = ""): FlatSpaceNode[] {
    const result: FlatSpaceNode[] = [];
    for (const space of spaces) {
        const path = parentPath ? `${parentPath} > ${space.name}` : space.name;
        result.push({ space, depth, path });
        if (space.children && space.children.length > 0) {
            result.push(...flattenSpaceTree(space.children, depth + 1, path));
        }
    }
    return result;
}
