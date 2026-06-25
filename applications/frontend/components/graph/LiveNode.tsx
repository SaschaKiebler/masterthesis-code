"use client";

/**
 * LiveNode — SCADA-style React Flow node for the synoptic view.
 *
 * Renders a large visual symbol (SVG icon or fallback Lucide icon) as the
 * centerpiece, with the name above it and live measurement values in a
 * prominent panel below. Designed to look like a real SCADA/HMI display.
 */

import { memo, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils/cn";
import {
    Building2, Layers, Home, DoorOpen, Warehouse, Wrench, Cpu,
    Radio, Router, Flame, Droplets, Gauge, Zap, User, GitBranch, Network,
} from "lucide-react";
import type { LatestValue } from "@/lib/api/projects";

const ICON_MAP: Record<string, React.ElementType> = {
    BUILDING: Building2, FLOOR: Layers, APARTMENT: Home, ROOM: DoorOpen,
    BASEMENT: Warehouse, COMMON_AREA: Building2, TECHNICAL_ROOM: Wrench,
    HEATING_CIRCUIT: GitBranch, HEATING_ZONE: Network, DISTRIBUTION_NETWORK: Network,
    PERSON: User, GENERIC_SENSOR: Cpu, ACTUATOR: Radio, CONTROLLER: Router,
    GATEWAY: Router, BOILER: Flame, PUMP: Droplets, HEAT_METER: Gauge, ENERGY_METER: Zap,
};

const CATEGORY_COLOR: Record<string, string> = {
    STRUCTURE: "#60a5fa",
    SPACE:     "#34d399",
    DEVICE:    "#fbbf24",
    SYSTEM:    "#a78bfa",
    CONTACT:   "#f472b6",
};

const CATEGORY_BG: Record<string, string> = {
    STRUCTURE: "bg-blue-500/10",
    SPACE:     "bg-emerald-500/10",
    DEVICE:    "bg-amber-500/10",
    SYSTEM:    "bg-purple-500/10",
    CONTACT:   "bg-pink-500/10",
};

export interface LiveNodeData {
    displayName: string;
    objectTypeName: string;
    objectTypeDisplayName: string;
    objectTypeCategory: string;
    svgIconUrl?: string;
    liveValues?: LatestValue[];
    deviceStatus?: "online" | "stale" | "offline" | "no_data";
    [key: string]: unknown;
}

const STATUS_COLOR: Record<string, string> = {
    online:  "#22c55e",
    stale:   "#f59e0b",
    offline: "#ef4444",
    no_data: "#6b7280",
};

function formatValue(value: number, unit: string): string {
    const abs = Math.abs(value);
    let formatted: string;
    if (abs >= 1000) formatted = value.toFixed(0);
    else if (abs >= 100) formatted = value.toFixed(0);
    else if (abs >= 10) formatted = value.toFixed(1);
    else formatted = value.toFixed(1);
    return `${formatted} ${unit}`;
}

function LiveNodeComponent({ data, selected }: NodeProps & { data: LiveNodeData }) {
    const nodeData = data as LiveNodeData;
    const Icon = ICON_MAP[nodeData.objectTypeName] ?? Cpu;
    const color = CATEGORY_COLOR[nodeData.objectTypeCategory] ?? "#94a3b8";
    const bgClass = CATEGORY_BG[nodeData.objectTypeCategory] ?? "bg-muted/20";
    const [expanded, setExpanded] = useState(false);
    const hasValues = nodeData.liveValues && nodeData.liveValues.length > 0;
    const hasMore = hasValues && nodeData.liveValues!.length > 4;
    const visibleValues = hasValues ? (expanded ? nodeData.liveValues! : nodeData.liveValues!.slice(0, 4)) : [];
    const statusColor = nodeData.deviceStatus ? STATUS_COLOR[nodeData.deviceStatus] : undefined;

    const handleClass = "w-2! h-2! bg-transparent! border-none! hover:bg-primary! transition-colors";

    return (
        <>
            <Handle id="top"    type="source" position={Position.Top}    className={handleClass} />
            <Handle id="bottom" type="source" position={Position.Bottom} className={handleClass} />
            <Handle id="left"   type="source" position={Position.Left}   className={handleClass} />
            <Handle id="right"  type="source" position={Position.Right}  className={handleClass} />
            <Handle id="top-target"    type="target" position={Position.Top}    className={handleClass} />
            <Handle id="bottom-target" type="target" position={Position.Bottom} className={handleClass} />
            <Handle id="left-target"   type="target" position={Position.Left}   className={handleClass} />
            <Handle id="right-target"  type="target" position={Position.Right}  className={handleClass} />

            {/* No scale transform on select — it changes the measured box and, combined
                with Windows fractional display scaling, can trigger React Flow's infinite
                measure→setNodes loop (React error #185). The ring below is the highlight. */}
            <div className="flex flex-col items-center">
                {/* Status indicator + Name label */}
                <div className="flex items-center gap-1.5 mb-1">
                    {statusColor && (
                        <span
                            className="h-2.5 w-2.5 rounded-full shrink-0 shadow-sm"
                            style={{ backgroundColor: statusColor, boxShadow: `0 0 6px ${statusColor}60` }}
                        />
                    )}
                    <span className="text-xs font-semibold text-foreground max-w-[180px] truncate">
                        {nodeData.displayName}
                    </span>
                </div>

                {/* Large symbol area */}
                <div
                    className={cn(
                        "rounded-xl flex items-center justify-center transition-all",
                        bgClass,
                        selected && "ring-2 ring-primary ring-offset-2 ring-offset-background"
                    )}
                    style={{
                        width: 80,
                        height: 80,
                        border: `2px solid ${color}40`,
                    }}
                >
                    {nodeData.svgIconUrl ? (
                        <img
                            src={nodeData.svgIconUrl}
                            alt={nodeData.objectTypeName}
                            className="w-14 h-14"
                            draggable={false}
                        />
                    ) : (
                        <Icon
                            className="w-10 h-10"
                            style={{ color }}
                            aria-hidden="true"
                        />
                    )}
                </div>

                {/* Type label */}
                <span className="text-[10px] text-muted-foreground mt-0.5">
                    {nodeData.objectTypeDisplayName}
                </span>

                {/* Measurement values panel */}
                {hasValues && (
                    <div
                        className="mt-1.5 rounded-lg border border-border/60 bg-card/95 backdrop-blur-sm shadow-md min-w-[160px] max-w-[240px]"
                    >
                        <table className="w-full">
                            <tbody>
                                {visibleValues.map((v) => (
                                    <tr key={v.metricPointId} className="border-b border-border/30 last:border-b-0">
                                        <td className="text-[11px] text-muted-foreground pl-2.5 pr-2 py-1 truncate max-w-[100px]">
                                            {v.quantityName || v.displayName}
                                        </td>
                                        <td className="text-sm font-mono font-bold text-foreground pr-2.5 py-1 text-right whitespace-nowrap">
                                            {v.value !== null ? formatValue(v.value, v.unit) : (
                                                <span className="text-muted-foreground font-normal">—</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {hasMore && (
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
                                className="w-full text-[10px] text-primary hover:text-primary/80 text-center py-1 border-t border-border/30 cursor-pointer"
                            >
                                {expanded ? "Show less" : `+${nodeData.liveValues!.length - 4} more`}
                            </button>
                        )}
                    </div>
                )}
            </div>
        </>
    );
}

export const LiveNode = memo(LiveNodeComponent);
