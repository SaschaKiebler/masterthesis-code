/**
 * graph-model.ts — mapping between the condition-builder graph and the
 * anomaly rule's ConditionTree.
 *
 * Graph shape: condition leaves and AND/OR group nodes; an edge goes from a
 * child's source handle to a group's target handle. Exactly one group has no
 * outgoing edge — that root group is the rule.
 */

import Dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";
import type {
    ChannelBinding,
    ChannelOption,
    ConditionAggregate,
    ConditionLeaf,
    ConditionOperator,
    ConditionTree,
} from "@/lib/api/anomalyRules";

// ── Node data ────────────────────────────────────────────────────────────────

export interface ConditionNodeData extends Record<string, unknown> {
    agg: ConditionAggregate;
    metricPointId: string;
    /** Window in minutes, kept as typed draft string (comma tolerant). */
    windowMin: string;
    op: ConditionOperator;
    /** Comparison value, kept as typed draft string (comma tolerant). */
    value: string;
}

export interface GroupNodeData extends Record<string, unknown> {
    mode: "all" | "any";
}

export type BuilderNode = Node<ConditionNodeData, "condition"> | Node<GroupNodeData, "group">;

export const CONDITION_NODE_SIZE = { width: 260, height: 210 };
export const GROUP_NODE_SIZE = { width: 96, height: 48 };

export const OP_SYMBOL: Record<ConditionOperator, string> = {
    GT: ">", LT: "<", GTE: "≥", LTE: "≤",
};

export const AGGREGATE_LABEL: Record<ConditionAggregate, string> = {
    duty: "duty cycle",
    mean: "average",
    min: "minimum",
    max: "maximum",
    last: "last value",
    edges_per_hour: "starts/h",
    t_out: "outdoor °C",
};

let idCounter = 0;
export function nextId(prefix: string): string {
    idCounter += 1;
    return `${prefix}-${idCounter}`;
}

/** Parse a user-typed number, accepting both "." and "," as separator. */
export function parseNumber(raw: string): number {
    return parseFloat(raw.trim().replace(",", "."));
}

export function channelLabel(channel: ChannelOption | undefined): string {
    if (!channel) return "unknown channel";
    const asset = channel.assetName ?? channel.deviceId;
    return `${asset} · ${channel.metricName}`;
}

// ── Graph → ConditionTree ────────────────────────────────────────────────────

export interface SerializedCondition {
    condition: ConditionTree;
    bindings: ChannelBinding[];
    /** Human-readable description of the tree. */
    description: string;
}

export interface SerializeResult {
    ok?: SerializedCondition;
    errors: string[];
}

export function graphToCondition(
    nodes: BuilderNode[],
    edges: Edge[],
    channels: ChannelOption[],
): SerializeResult {
    const errors: string[] = [];
    const groups = nodes.filter((n) => n.type === "group");
    const conditions = nodes.filter((n) => n.type === "condition");

    if (conditions.length === 0) {
        return { errors: ["Add at least one condition."] };
    }

    // The root is the group nobody feeds into another node from.
    const hasOutgoing = new Set(edges.map((e) => e.source));
    const roots = groups.filter((g) => !hasOutgoing.has(g.id));
    if (roots.length === 0) {
        return { errors: ["Add a root AND/OR group."] };
    }
    if (roots.length > 1) {
        return { errors: ["Only one root group is allowed — connect the others into it."] };
    }
    const root = roots[0];

    const childrenOf = new Map<string, string[]>();
    for (const edge of edges) {
        const list = childrenOf.get(edge.target) ?? [];
        list.push(edge.source);
        childrenOf.set(edge.target, list);
    }

    const byId = new Map(nodes.map((n) => [n.id, n]));
    const roleByChannel = new Map<string, string>();
    const bindings: ChannelBinding[] = [];
    const reached = new Set<string>();

    const buildNode = (nodeId: string, stack: Set<string>): ConditionTree | ConditionLeaf | null => {
        if (stack.has(nodeId)) {
            errors.push("The graph contains a cycle.");
            return null;
        }
        const node = byId.get(nodeId);
        if (!node) return null;
        reached.add(nodeId);

        if (node.type === "condition") {
            const data = node.data as ConditionNodeData;
            const value = parseNumber(data.value);
            if (isNaN(value)) {
                errors.push("Every condition needs a numeric value.");
                return null;
            }
            if (data.agg === "t_out") {
                return { agg: "t_out", op: data.op, value };
            }
            if (!data.metricPointId) {
                errors.push("Every condition needs a channel.");
                return null;
            }
            const windowMin = parseNumber(data.windowMin);
            if (isNaN(windowMin) || windowMin <= 0) {
                errors.push("Every condition needs a positive window (minutes).");
                return null;
            }
            let role = roleByChannel.get(data.metricPointId);
            if (!role) {
                role = `c${roleByChannel.size + 1}`;
                roleByChannel.set(data.metricPointId, role);
                bindings.push({ role, metricPointId: data.metricPointId });
            }
            return {
                agg: data.agg,
                role,
                window_s: Math.round(windowMin * 60),
                op: data.op,
                value,
            };
        }

        // Group node
        const childIds = childrenOf.get(nodeId) ?? [];
        if (childIds.length === 0) {
            errors.push("Every group needs at least one incoming condition.");
            return null;
        }
        const nextStack = new Set(stack).add(nodeId);
        const children = childIds
            .map((childId) => buildNode(childId, nextStack))
            .filter((c): c is ConditionTree | ConditionLeaf => c !== null);
        if (children.length !== childIds.length) return null;
        const mode = (node.data as GroupNodeData).mode;
        return { [mode]: children } as ConditionTree;
    };

    const condition = buildNode(root.id, new Set());

    for (const node of nodes) {
        if (!reached.has(node.id)) {
            errors.push("Some blocks are not connected to the root group.");
            break;
        }
    }

    if (errors.length > 0 || condition === null) {
        return { errors: [...new Set(errors)] };
    }
    if (bindings.length === 0) {
        return { errors: ["At least one condition must reference a channel."] };
    }

    const tree = condition as ConditionTree;
    return {
        errors: [],
        ok: {
            condition: tree,
            bindings,
            description: describeCondition(tree, roleLabelMap(bindings, channels)),
        },
    };
}

function roleLabelMap(bindings: ChannelBinding[], channels: ChannelOption[]): Map<string, string> {
    const byId = new Map(channels.map((c) => [c.metricPointId, c]));
    return new Map(bindings.map((b) => [b.role, channelLabel(byId.get(b.metricPointId))]));
}

// ── ConditionTree → description ──────────────────────────────────────────────

export function describeCondition(
    node: ConditionTree | ConditionLeaf,
    roleLabels: Map<string, string>,
): string {
    if ("all" in node || "any" in node) {
        const tree = node as ConditionTree;
        const children = tree.all ?? tree.any ?? [];
        const joiner = tree.all ? " AND " : " OR ";
        const parts = children.map((child) => {
            const text = describeCondition(child, roleLabels);
            return "all" in child || "any" in child ? `(${text})` : text;
        });
        return parts.join(joiner);
    }
    const leaf = node as ConditionLeaf;
    const op = OP_SYMBOL[leaf.op] ?? leaf.op;
    if (leaf.agg === "t_out") {
        return `outdoor °C ${op} ${leaf.value}`;
    }
    const label = leaf.role ? roleLabels.get(leaf.role) ?? leaf.role : "?";
    const window = leaf.window_s ? ` over ${Math.round(leaf.window_s / 60)} min` : "";
    return `${AGGREGATE_LABEL[leaf.agg] ?? leaf.agg}(${label})${window} ${op} ${leaf.value}`;
}

/** Description straight from a stored rule (for the sidebar rule list). */
export function describeRule(
    condition: ConditionTree | undefined,
    bindings: ChannelBinding[],
    channels: ChannelOption[],
): string {
    if (!condition) return "";
    return describeCondition(condition, roleLabelMap(bindings, channels));
}

// ── ConditionTree → graph (edit mode) ────────────────────────────────────────

export function conditionToGraph(
    condition: ConditionTree,
    bindings: ChannelBinding[],
): { nodes: BuilderNode[]; edges: Edge[] } {
    const channelByRole = new Map(bindings.map((b) => [b.role, b.metricPointId]));
    const nodes: BuilderNode[] = [];
    const edges: Edge[] = [];

    const walk = (node: ConditionTree | ConditionLeaf): string => {
        if ("all" in node || "any" in node) {
            const tree = node as ConditionTree;
            const id = nextId("group");
            nodes.push({
                id,
                type: "group",
                position: { x: 0, y: 0 },
                data: { mode: tree.all ? "all" : "any" },
            });
            for (const child of tree.all ?? tree.any ?? []) {
                const childId = walk(child);
                edges.push(makeEdge(childId, id));
            }
            return id;
        }
        const leaf = node as ConditionLeaf;
        const id = nextId("condition");
        nodes.push({
            id,
            type: "condition",
            position: { x: 0, y: 0 },
            data: {
                agg: leaf.agg,
                metricPointId: leaf.role ? channelByRole.get(leaf.role) ?? "" : "",
                windowMin: leaf.window_s ? String(Math.round(leaf.window_s / 60)) : "30",
                op: leaf.op,
                value: String(leaf.value),
            },
        });
        return id;
    };

    walk(condition);
    return { nodes: layoutGraph(nodes, edges), edges };
}

export function makeEdge(sourceId: string, targetId: string): Edge {
    return {
        id: `e-${sourceId}-${targetId}`,
        source: sourceId,
        target: targetId,
        type: "smoothstep",
        animated: false,
        style: { strokeWidth: 1.5 },
    };
}

/** Left-to-right dagre layout: conditions on the left, root group on the right. */
export function layoutGraph(nodes: BuilderNode[], edges: Edge[]): BuilderNode[] {
    const graph = new Dagre.graphlib.Graph();
    graph.setDefaultEdgeLabel(() => ({}));
    graph.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 90 });
    for (const node of nodes) {
        const size = node.type === "group" ? GROUP_NODE_SIZE : CONDITION_NODE_SIZE;
        graph.setNode(node.id, { ...size });
    }
    for (const edge of edges) {
        graph.setEdge(edge.source, edge.target);
    }
    Dagre.layout(graph);
    return nodes.map((node) => {
        const positioned = graph.node(node.id);
        const size = node.type === "group" ? GROUP_NODE_SIZE : CONDITION_NODE_SIZE;
        return {
            ...node,
            position: {
                x: positioned.x - size.width / 2,
                y: positioned.y - size.height / 2,
            },
        };
    });
}
