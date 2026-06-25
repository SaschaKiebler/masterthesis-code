"use client";

/**
 * ObjectNode — custom React Flow node for the visual graph editor.
 * Renders a compact card with a category-coloured icon, display name, and type label.
 */

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils/cn";
import {
    Building2, Layers, Home, DoorOpen, Warehouse, Wrench, Cpu,
    Radio, Router, Flame, Droplets, Gauge, Zap, User, GitBranch, Network,
} from "lucide-react";

const ICON_MAP: Record<string, React.ElementType> = {
    BUILDING: Building2, FLOOR: Layers, APARTMENT: Home, ROOM: DoorOpen,
    BASEMENT: Warehouse, COMMON_AREA: Building2, TECHNICAL_ROOM: Wrench,
    HEATING_CIRCUIT: GitBranch, HEATING_ZONE: Network, DISTRIBUTION_NETWORK: Network,
    PERSON: User, GENERIC_SENSOR: Cpu, ACTUATOR: Radio, CONTROLLER: Router,
    GATEWAY: Router, BOILER: Flame, PUMP: Droplets, HEAT_METER: Gauge, ENERGY_METER: Zap,
};

const CATEGORY_BORDER: Record<string, string> = {
    STRUCTURE: "border-blue-400",
    SPACE:     "border-emerald-400",
    DEVICE:    "border-amber-400",
    SYSTEM:    "border-purple-400",
    CONTACT:   "border-pink-400",
};

const CATEGORY_ICON_COLOR: Record<string, string> = {
    STRUCTURE: "text-blue-500",
    SPACE:     "text-emerald-500",
    DEVICE:    "text-amber-500",
    SYSTEM:    "text-purple-500",
    CONTACT:   "text-pink-500",
};

export interface ObjectNodeData {
    displayName: string;
    objectTypeName: string;
    objectTypeDisplayName: string;
    objectTypeCategory: string;
    [key: string]: unknown;
}

function ObjectNodeComponent({ data, selected }: NodeProps & { data: ObjectNodeData }) {
    const nodeData = data as ObjectNodeData;
    const Icon = ICON_MAP[nodeData.objectTypeName] ?? Cpu;
    const borderColor = CATEGORY_BORDER[nodeData.objectTypeCategory] ?? "border-border";
    const iconColor = CATEGORY_ICON_COLOR[nodeData.objectTypeCategory] ?? "text-muted-foreground";

    const handleClass = "w-2.5! h-2.5! bg-muted-foreground/40! border-card! hover:bg-primary! transition-colors";

    return (
        <>
            {/* Handles on all four sides — each acts as both source and target */}
            <Handle id="top"    type="source" position={Position.Top}    className={handleClass} />
            <Handle id="bottom" type="source" position={Position.Bottom} className={handleClass} />
            <Handle id="left"   type="source" position={Position.Left}   className={handleClass} />
            <Handle id="right"  type="source" position={Position.Right}  className={handleClass} />

            <Handle id="top-target"    type="target" position={Position.Top}    className={handleClass} />
            <Handle id="bottom-target" type="target" position={Position.Bottom} className={handleClass} />
            <Handle id="left-target"   type="target" position={Position.Left}   className={handleClass} />
            <Handle id="right-target"  type="target" position={Position.Right}  className={handleClass} />

            {/* Fixed integer dimensions (match NODE_WIDTH/NODE_HEIGHT) so React Flow's
                ResizeObserver measures a stable box. Content-sized nodes oscillate on
                Windows fractional display scaling (125%/150%), triggering an infinite
                measure→setNodes loop (React error #185). Selection highlight uses a ring
                only — no scale transform, which would also change the measured box. */}
            <div
                style={{ width: 170, height: 60 }}
                className={cn(
                    "flex flex-col justify-center rounded-lg border-2 bg-card px-3 py-2 shadow-sm transition-colors overflow-hidden",
                    borderColor,
                    selected && "ring-2 ring-primary ring-offset-2 ring-offset-background"
                )}
            >
                <div className="flex items-center gap-2">
                    <Icon className={cn("h-4 w-4 shrink-0", iconColor)} aria-hidden="true" />
                    <span className="text-sm font-medium text-foreground truncate">
                        {nodeData.displayName}
                    </span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5 truncate pl-6">
                    {nodeData.objectTypeDisplayName}
                </p>
            </div>
        </>
    );
}

export const ObjectNode = memo(ObjectNodeComponent);
