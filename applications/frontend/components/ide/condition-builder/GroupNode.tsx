"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { useBuilder } from "./builder-context";
import { GROUP_NODE_SIZE, type GroupNodeData } from "./graph-model";

/**
 * AND/OR group node. Conditions (and other groups) connect into its left
 * side; its right side feeds the next group up. Clicking the badge toggles
 * the mode. The group without an outgoing edge is the rule's root.
 */
function GroupNodeInner({ id, data, selected }: NodeProps<Node<GroupNodeData, "group">>) {
    const { updateNode } = useBuilder();
    const isAnd = data.mode === "all";
    return (
        <div
            className={`rounded-lg border bg-card shadow-sm flex items-center justify-center ${
                selected ? "border-primary" : "border-border"
            }`}
            style={{ width: GROUP_NODE_SIZE.width, height: GROUP_NODE_SIZE.height }}
        >
            <button
                type="button"
                onClick={() => updateNode(id, { mode: isAnd ? "any" : "all" })}
                className={`nodrag text-xs font-bold px-3 py-1 rounded transition-colors ${
                    isAnd
                        ? "bg-primary/15 text-primary"
                        : "bg-amber-500/15 text-amber-500"
                }`}
                title="Toggle AND/OR"
            >
                {isAnd ? "AND" : "OR"}
            </button>
            <Handle
                type="target"
                position={Position.Left}
                className="w-2.5! h-2.5! bg-muted-foreground! border-2! border-background!"
            />
            <Handle
                type="source"
                position={Position.Right}
                className="w-2.5! h-2.5! bg-primary! border-2! border-background!"
            />
        </div>
    );
}

export const GroupNode = memo(GroupNodeInner);
