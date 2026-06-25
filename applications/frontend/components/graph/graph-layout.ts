/**
 * graph-layout.ts — dagre-based auto-layout for the visual graph editor.
 *
 * Takes GraphObject[] + GraphLink[] from the API and returns
 * React Flow Node[] + Edge[] with computed x/y positions.
 */

import Dagre from "@dagrejs/dagre";
import type { Node, Edge } from "@xyflow/react";
import type { GraphObject, GraphLink } from "@/lib/api/types";
import type { ObjectNodeData } from "./ObjectNode";

// Rank priority by category — lower = higher in the diagram
const CATEGORY_RANK: Record<string, number> = {
    STRUCTURE:  0,
    SPACE:      1,
    SYSTEM:     1,
    DEVICE:     2,
    SENSOR:     2,
    ACTUATOR:   2,
    CONTROLLER: 2,
    GATEWAY:    2,
    METER:      2,
    CONTACT:    2,
};

function categoryRank(category: string): number {
    return CATEGORY_RANK[category] ?? 1;
}

const CATEGORY_EDGE_COLOR: Record<string, string> = {
    STRUCTURE: "#60a5fa", // blue-400
    SPACE:     "#34d399", // emerald-400
    DEVICE:    "#fbbf24", // amber-400
    SYSTEM:    "#a78bfa", // purple-400
    CONTACT:   "#f472b6", // pink-400
};

export const NODE_WIDTH = 170;
export const NODE_HEIGHT = 60;

/**
 * Pick the best source/target handle pair based on relative node positions.
 * Returns { sourceHandle, targetHandle } IDs that match the Handle ids in ObjectNode.
 */
function bestHandles(
    srcX: number, srcY: number,
    tgtX: number, tgtY: number,
): { sourceHandle: string; targetHandle: string } {
    const dx = tgtX - srcX;
    const dy = tgtY - srcY;

    // If vertical distance dominates → use top/bottom
    if (Math.abs(dy) > Math.abs(dx) * 0.6) {
        if (dy > 0) {
            return { sourceHandle: "bottom", targetHandle: "top-target" };
        }
        return { sourceHandle: "top", targetHandle: "bottom-target" };
    }
    // Horizontal distance dominates → use left/right
    if (dx > 0) {
        return { sourceHandle: "right", targetHandle: "left-target" };
    }
    return { sourceHandle: "left", targetHandle: "right-target" };
}

/**
 * Run dagre layout on the graph and return positioned React Flow nodes + edges.
 * Accepts optional nodeWidth/nodeHeight overrides for different view modes (e.g., SCADA vs IDE).
 */
export function computeLayout(
    objects: GraphObject[],
    links: GraphLink[],
    options?: { nodeWidth?: number; nodeHeight?: number; nodesep?: number; ranksep?: number }
): { nodes: Node<ObjectNodeData>[]; edges: Edge[] } {
    const nw = options?.nodeWidth ?? NODE_WIDTH;
    const nh = options?.nodeHeight ?? NODE_HEIGHT;

    const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));

    g.setGraph({
        rankdir: "TB",
        nodesep: options?.nodesep ?? 60,
        ranksep: options?.ranksep ?? 80,
        marginx: 20,
        marginy: 20,
    });

    // Build a quick category lookup
    const catMap = new Map<string, string>();
    for (const obj of objects) {
        catMap.set(obj.id, obj.objectTypeCategory);
    }

    // Add nodes
    for (const obj of objects) {
        g.setNode(obj.id, { width: nw, height: nh });
    }

    // Add edges — reverse direction in dagre when source has a higher category rank
    // than target, so dagre places STRUCTURE above SPACE above DEVICE.
    // React Flow edges keep their original direction (arrows are independent).
    for (const link of links) {
        const srcRank = categoryRank(catMap.get(link.sourceId) ?? "");
        const tgtRank = categoryRank(catMap.get(link.targetId) ?? "");
        if (srcRank > tgtRank) {
            // Source is lower in hierarchy → reverse for dagre so target ranks higher
            g.setEdge(link.targetId, link.sourceId);
        } else {
            g.setEdge(link.sourceId, link.targetId);
        }
    }

    Dagre.layout(g);

    // Convert to React Flow nodes
    const nodes: Node<ObjectNodeData>[] = objects.map((obj) => {
        const pos = g.node(obj.id);
        return {
            id: obj.id,
            type: "objectNode",
            // Explicit dimensions → React Flow skips ResizeObserver-driven remeasurement,
            // which oscillates on Windows fractional display scaling (React error #185).
            width: nw,
            height: nh,
            position: {
                x: (pos?.x ?? 0) - nw / 2,
                y: (pos?.y ?? 0) - nh / 2,
            },
            data: {
                displayName: obj.displayName ?? obj.id,
                objectTypeName: obj.objectTypeName,
                objectTypeDisplayName: obj.objectTypeDisplayName,
                objectTypeCategory: obj.objectTypeCategory,
            },
        };
    });

    // Build a position lookup for handle selection
    const posMap = new Map<string, { x: number; y: number }>();
    for (const obj of objects) {
        const pos = g.node(obj.id);
        if (pos) posMap.set(obj.id, { x: pos.x, y: pos.y });
    }

    const edges = buildEdges(objects, links, posMap);

    return { nodes, edges };
}

/**
 * Build React Flow edges from graph links using a position map for handle selection.
 * Extracted so incremental mode can rebuild edges without running Dagre.
 */
export function buildEdges(
    objects: GraphObject[],
    links: GraphLink[],
    positionMap: Map<string, { x: number; y: number }>,
): Edge[] {
    return links.map((link) => {
        const sourceObj = objects.find((o) => o.id === link.sourceId);
        const edgeColor = CATEGORY_EDGE_COLOR[sourceObj?.objectTypeCategory ?? ""] ?? "#94a3b8";

        const srcPos = positionMap.get(link.sourceId) ?? { x: 0, y: 0 };
        const tgtPos = positionMap.get(link.targetId) ?? { x: 0, y: 0 };
        const { sourceHandle, targetHandle } = bestHandles(srcPos.x, srcPos.y, tgtPos.x, tgtPos.y);

        return {
            id: link.id,
            source: link.sourceId,
            target: link.targetId,
            sourceHandle,
            targetHandle,
            type: "smoothstep",
            animated: false,
            label: link.linkTypeDisplayName || link.linkTypeName,
            labelStyle: { fontSize: 10, fontWeight: 500, fill: "#64748b" },
            labelBgStyle: { fill: "var(--color-card, #ffffff)", fillOpacity: 0.9 },
            labelBgPadding: [4, 2] as [number, number],
            labelBgBorderRadius: 4,
            style: { stroke: edgeColor, strokeWidth: 1.5 },
            markerEnd: { type: "arrowclosed" as const, color: edgeColor, width: 16, height: 16 },
            data: { linkId: link.id, linkTypeName: link.linkTypeName },
        };
    });
}
