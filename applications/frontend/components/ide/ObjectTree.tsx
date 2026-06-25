"use client";

/**
 * ObjectTree — left panel of the IDE.
 * Folder-style hierarchy of all objects grouped by category.
 * Supports search, selection, and collapse/expand per group.
 */

import { useState, useMemo, useCallback } from "react";
import { cn } from "@/lib/utils/cn";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import type { GraphObject } from "@/lib/api/types";
import {
    Search, ChevronRight, ChevronDown, Plus,
    Building2, Layers, Home, DoorOpen, Warehouse, Wrench, Cpu,
    Radio, Router, Flame, Droplets, Gauge, Zap, User, GitBranch, Network,
} from "lucide-react";

// ─── Icon + colour maps (shared with ObjectNode) ─────────────────────────────

const ICON_MAP: Record<string, React.ElementType> = {
    BUILDING: Building2, FLOOR: Layers, APARTMENT: Home, ROOM: DoorOpen,
    BASEMENT: Warehouse, COMMON_AREA: Building2, TECHNICAL_ROOM: Wrench,
    HEATING_CIRCUIT: GitBranch, HEATING_ZONE: Network, DISTRIBUTION_NETWORK: Network,
    PERSON: User, GENERIC_SENSOR: Cpu, ACTUATOR: Radio, CONTROLLER: Router,
    GATEWAY: Router, BOILER: Flame, PUMP: Droplets, HEAT_METER: Gauge, ENERGY_METER: Zap,
    WATER_METER: Droplets, TEMPERATURE_SENSOR: Gauge, VALVE_ACTUATOR: Radio,
};

const CATEGORY_ICON: Record<string, React.ElementType> = {
    STRUCTURE: Building2,
    SPACE: Layers,
    DEVICE: Cpu,
    SYSTEM: GitBranch,
    CONTACT: User,
};

const CATEGORY_COLOR: Record<string, string> = {
    STRUCTURE: "text-blue-500",
    SPACE: "text-emerald-500",
    DEVICE: "text-amber-500",
    SYSTEM: "text-purple-500",
    CONTACT: "text-pink-500",
};

const CATEGORY_ORDER = ["STRUCTURE", "SPACE", "DEVICE", "SYSTEM", "CONTACT"];

// ─── Types ────────────────────────────────────────────────────────────────────

interface ObjectTreeProps {
    objects: GraphObject[];
    selectedObjectId: string | null;
    onSelectObject: (object: GraphObject) => void;
    onCreateObject?: (category?: string) => void;
}

interface CategoryGroup {
    category: string;
    label: string;
    objects: GraphObject[];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ObjectTree({
    objects,
    selectedObjectId,
    onSelectObject,
    onCreateObject,
}: ObjectTreeProps) {
    const [search, setSearch] = useState("");
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

    const filteredObjects = useMemo(() => {
        if (!search.trim()) return objects;
        const q = search.toLowerCase();
        return objects.filter(
            (o) =>
                o.displayName.toLowerCase().includes(q) ||
                o.objectTypeName.toLowerCase().includes(q) ||
                o.objectTypeCategory.toLowerCase().includes(q)
        );
    }, [objects, search]);

    const groups = useMemo<CategoryGroup[]>(() => {
        const map = new Map<string, GraphObject[]>();
        for (const obj of filteredObjects) {
            const cat = obj.objectTypeCategory || "DEVICE";
            if (!map.has(cat)) map.set(cat, []);
            map.get(cat)!.push(obj);
        }
        // Sort objects within each group alphabetically
        for (const arr of map.values()) {
            arr.sort((a, b) => a.displayName.localeCompare(b.displayName));
        }
        // Return groups in canonical order
        const result: CategoryGroup[] = [];
        for (const cat of CATEGORY_ORDER) {
            if (map.has(cat)) {
                result.push({ category: cat, label: formatCategory(cat), objects: map.get(cat)! });
                map.delete(cat);
            }
        }
        // Append any remaining categories
        for (const [cat, objs] of map) {
            result.push({ category: cat, label: formatCategory(cat), objects: objs });
        }
        return result;
    }, [filteredObjects]);

    const toggleGroup = useCallback((category: string) => {
        setCollapsed((prev) => ({ ...prev, [category]: !prev[category] }));
    }, []);

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* Header + Search */}
            <div className="p-3 border-b border-border shrink-0 space-y-2">
                <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                        Building Structure
                        <InfoTooltip text="Your building hierarchy — buildings, floors, rooms — and all connected sensors, devices, and heating systems." />
                    </span>
                    {onCreateObject && (
                        <button
                            onClick={() => onCreateObject()}
                            className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10 rounded-md transition-colors"
                        >
                            <Plus className="h-3.5 w-3.5" />
                            New
                        </button>
                    )}
                </div>
                <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                    <input
                        type="text"
                        placeholder="Search buildings, sensors, rooms..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full h-8 pl-8 pr-3 text-sm bg-background border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                </div>
            </div>

            {/* Tree */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden py-1">
                {groups.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-6">
                        {search ? "No results found." : "No items yet. Click \"New\" to add a building or sensor."}
                    </p>
                )}

                {groups.map((group) => {
                    const isCollapsed = collapsed[group.category] ?? false;
                    const CatIcon = CATEGORY_ICON[group.category] ?? Cpu;
                    const catColor = CATEGORY_COLOR[group.category] ?? "text-muted-foreground";

                    return (
                        <div key={group.category}>
                            {/* Category header */}
                            <button
                                onClick={() => toggleGroup(group.category)}
                                className="flex items-center gap-1.5 w-full px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors group"
                            >
                                {isCollapsed ? (
                                    <ChevronRight className="h-3 w-3 shrink-0" />
                                ) : (
                                    <ChevronDown className="h-3 w-3 shrink-0" />
                                )}
                                <CatIcon className={cn("h-3.5 w-3.5 shrink-0", catColor)} />
                                <span className="flex-1 text-left">{group.label}</span>
                                <span className="text-[10px] font-normal tabular-nums">
                                    {group.objects.length}
                                </span>
                                {onCreateObject && (
                                    <span
                                        role="button"
                                        tabIndex={-1}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onCreateObject(group.category);
                                        }}
                                        className="hidden group-hover:flex items-center justify-center h-4 w-4 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                        <Plus className="h-3 w-3" />
                                    </span>
                                )}
                            </button>

                            {/* Object list */}
                            {!isCollapsed && (
                                <div className="pb-1">
                                    {group.objects.map((obj) => {
                                        const Icon = ICON_MAP[obj.objectTypeName] ?? Cpu;
                                        const iconColor = CATEGORY_COLOR[obj.objectTypeCategory] ?? "text-muted-foreground";
                                        const isSelected = selectedObjectId === obj.id;

                                        return (
                                            <button
                                                key={obj.id}
                                                onClick={() => onSelectObject(obj)}
                                                className={cn(
                                                    "flex items-center gap-2 w-full px-3 pl-8 py-1 text-sm transition-colors truncate",
                                                    isSelected
                                                        ? "bg-primary/10 text-foreground"
                                                        : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                                                )}
                                            >
                                                <Icon className={cn("h-3.5 w-3.5 shrink-0", iconColor)} />
                                                <span className="truncate">{obj.displayName}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Footer */}
            <div className="border-t border-border px-3 py-2 shrink-0">
                <p className="text-[10px] text-muted-foreground">
                    {objects.length} item{objects.length !== 1 ? "s" : ""}
                </p>
            </div>
        </div>
    );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
    STRUCTURE: "Buildings & Floors",
    SPACE: "Rooms & Spaces",
    DEVICE: "Sensors & Devices",
    SYSTEM: "Heating Systems",
    CONTACT: "People",
};

function formatCategory(cat: string): string {
    return CATEGORY_LABELS[cat] ?? cat.charAt(0) + cat.slice(1).toLowerCase();
}
