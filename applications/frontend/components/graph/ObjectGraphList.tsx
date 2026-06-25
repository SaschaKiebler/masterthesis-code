"use client";

/**
 * ObjectGraphList — ADR-011 Phase C
 *
 * Renders all objects scoped to a site as a selectable list, grouped by
 * object type category (STRUCTURE → SPACE → DEVICE → SYSTEM → CONTACT).
 * Clicking an object selects it; the parent page wires this to ObjectLinksPanel.
 */

import { cn } from "@/lib/utils/cn";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { Badge } from "@/components/ui/Badge";
import type { GraphObject } from "@/lib/api/types";
import {
    Building2,
    Layers,
    Home,
    DoorOpen,
    Warehouse,
    Wrench,
    Cpu,
    Radio,
    Router,
    Flame,
    Droplets,
    Gauge,
    Zap,
    User,
    GitBranch,
    Network,
} from "lucide-react";

// ─── Type → icon mapping ──────────────────────────────────────────────────────

const OBJECT_TYPE_ICON: Record<string, React.ElementType> = {
    BUILDING:             Building2,
    FLOOR:                Layers,
    APARTMENT:            Home,
    ROOM:                 DoorOpen,
    BASEMENT:             Warehouse,
    COMMON_AREA:          Building2,
    TECHNICAL_ROOM:       Wrench,
    HEATING_CIRCUIT:      GitBranch,
    HEATING_ZONE:         Network,
    DISTRIBUTION_NETWORK: Network,
    PERSON:               User,
    GENERIC_SENSOR:       Cpu,
    ACTUATOR:             Radio,
    CONTROLLER:           Router,
    GATEWAY:              Router,
    BOILER:               Flame,
    PUMP:                 Droplets,
    HEAT_METER:           Gauge,
    ENERGY_METER:         Zap,
};

// ─── Category ordering & display ─────────────────────────────────────────────

const CATEGORY_ORDER = ["STRUCTURE", "SPACE", "DEVICE", "SYSTEM", "CONTACT"];

const CATEGORY_LABEL: Record<string, string> = {
    STRUCTURE: "Building",
    SPACE:     "Spaces",
    DEVICE:    "Devices",
    SYSTEM:    "Systems",
    CONTACT:   "Contacts",
};

const CATEGORY_COLOR: Record<string, string> = {
    STRUCTURE: "text-blue-500",
    SPACE:     "text-emerald-500",
    DEVICE:    "text-amber-500",
    SYSTEM:    "text-purple-500",
    CONTACT:   "text-pink-500",
};

// ─── Component ────────────────────────────────────────────────────────────────

interface ObjectGraphListProps {
    objects: GraphObject[];
    loading: boolean;
    error: string | null;
    selectedObjectId: string | null;
    onSelect: (object: GraphObject) => void;
    className?: string;
}

export function ObjectGraphList({
    objects,
    loading,
    error,
    selectedObjectId,
    onSelect,
    className,
}: ObjectGraphListProps) {
    if (loading) {
        return (
            <div className={cn("flex items-center justify-center py-10", className)}>
                <LoadingSpinner />
            </div>
        );
    }

    if (error) {
        return <p className={cn("text-sm text-danger px-3", className)}>{error}</p>;
    }

    if (objects.length === 0) {
        return (
            <p className={cn("text-sm text-muted-foreground text-center py-8 px-3", className)}>
                No objects registered for this site yet.
            </p>
        );
    }

    // Group by category, preserving CATEGORY_ORDER
    const grouped = CATEGORY_ORDER.reduce<Record<string, GraphObject[]>>((acc, cat) => {
        const items = objects.filter((o) => o.objectTypeCategory === cat);
        if (items.length > 0) acc[cat] = items;
        return acc;
    }, {});

    // Any category not in the ordered list goes last
    objects.forEach((o) => {
        const cat = o.objectTypeCategory;
        if (!CATEGORY_ORDER.includes(cat) && !grouped[cat]) {
            grouped[cat] = [];
        }
        if (!CATEGORY_ORDER.includes(cat)) {
            grouped[cat].push(o);
        }
    });

    return (
        <div className={cn("space-y-4", className)}>
            {Object.entries(grouped).map(([category, items]) => (
                <div key={category}>
                    {/* Category header */}
                    <div className="flex items-center gap-2 px-1 mb-1.5">
                        <span className={cn("text-xs font-semibold uppercase tracking-wider", CATEGORY_COLOR[category] ?? "text-muted-foreground")}>
                            {CATEGORY_LABEL[category] ?? category}
                        </span>
                        <Badge variant="default" size="sm">{items.length}</Badge>
                    </div>

                    {/* Object rows */}
                    <ul className="space-y-0.5" role="listbox" aria-label={CATEGORY_LABEL[category] ?? category}>
                        {items.map((obj) => {
                            const Icon = OBJECT_TYPE_ICON[obj.objectTypeName] ?? Cpu;
                            const isSelected = selectedObjectId === obj.id;
                            const iconColor = CATEGORY_COLOR[category] ?? "text-muted-foreground";

                            return (
                                <li key={obj.id} role="option" aria-selected={isSelected}>
                                    <button
                                        onClick={() => onSelect(obj)}
                                        className={cn(
                                            "w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                                            isSelected
                                                ? "bg-primary/10 border border-primary/20 text-foreground"
                                                : "border border-transparent hover:bg-muted/50 text-foreground"
                                        )}
                                    >
                                        <Icon className={cn("h-4 w-4 shrink-0", isSelected ? "text-primary" : iconColor)} aria-hidden="true" />
                                        <span className="flex-1 text-sm truncate">
                                            {obj.displayName ?? obj.id}
                                        </span>
                                        <span className="text-xs text-muted-foreground shrink-0 hidden sm:inline">
                                            {obj.objectTypeDisplayName}
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            ))}
        </div>
    );
}
