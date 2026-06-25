/**
 * Space Tree Component
 * Renders the building's spatial hierarchy as an interactive tree
 * Supports add, edit, delete operations inline
 */

"use client";

import { useState, useCallback } from "react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import type { SpaceDTO, AssetSummary } from "@/lib/api/types";
import {
    ChevronRight,
    ChevronDown,
    Plus,
    Pencil,
    Trash2,
    Building2,
    DoorOpen,
    Home,
    Warehouse,
    Layers,
    Wrench,
    Cpu,
} from "lucide-react";

const SPACE_TYPE_CONFIG: Record<string, { label: string; icon: typeof Building2; color: string }> = {
    FLOOR: { label: "Floor", icon: Layers, color: "text-blue-500" },
    APARTMENT: { label: "Apartment", icon: Home, color: "text-emerald-500" },
    ROOM: { label: "Room", icon: DoorOpen, color: "text-amber-500" },
    BASEMENT: { label: "Basement", icon: Warehouse, color: "text-slate-500" },
    COMMON_AREA: { label: "Common Area", icon: Building2, color: "text-purple-500" },
    TECHNICAL_ROOM: { label: "Technical Room", icon: Wrench, color: "text-red-500" },
};

interface SpaceTreeProps {
    spaces: SpaceDTO[];
    assets?: AssetSummary[];
    onAddSpace: (parentSpaceId?: string) => void;
    onEditSpace: (space: SpaceDTO) => void;
    onDeleteSpace: (space: SpaceDTO) => void;
    onSelectSpace?: (space: SpaceDTO) => void;
    selectedSpaceId?: string | null;
    compact?: boolean;
}

export function SpaceTree({
    spaces,
    assets = [],
    onAddSpace,
    onEditSpace,
    onDeleteSpace,
    onSelectSpace,
    selectedSpaceId,
    compact = false,
}: SpaceTreeProps) {
    if (spaces.length === 0) {
        return (
            <div className="text-center py-8">
                <Building2 className="h-10 w-10 text-muted-foreground mx-auto mb-3" aria-hidden="true" />
                <p className="text-sm text-muted-foreground mb-3">
                    No spaces defined yet. Model the building structure first.
                </p>
                <Button variant="primary" size="sm" onClick={() => onAddSpace()}>
                    <Plus className="h-4 w-4 mr-1.5" aria-hidden="true" />
                    Add First Space
                </Button>
            </div>
        );
    }

    return (
        <div className="space-y-1" role="tree" aria-label="Building spaces">
            {spaces.map((space) => (
                <SpaceTreeNode
                    key={space.id}
                    space={space}
                    assets={assets}
                    depth={0}
                    onAddSpace={onAddSpace}
                    onEditSpace={onEditSpace}
                    onDeleteSpace={onDeleteSpace}
                    onSelectSpace={onSelectSpace}
                    selectedSpaceId={selectedSpaceId}
                    compact={compact}
                />
            ))}
            {!compact && (
                <button
                    onClick={() => onAddSpace()}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-lg transition-colors"
                >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Add root space
                </button>
            )}
        </div>
    );
}

interface SpaceTreeNodeProps {
    space: SpaceDTO;
    assets: AssetSummary[];
    depth: number;
    onAddSpace: (parentSpaceId?: string) => void;
    onEditSpace: (space: SpaceDTO) => void;
    onDeleteSpace: (space: SpaceDTO) => void;
    onSelectSpace?: (space: SpaceDTO) => void;
    selectedSpaceId?: string | null;
    compact: boolean;
}

function SpaceTreeNode({
    space,
    assets,
    depth,
    onAddSpace,
    onEditSpace,
    onDeleteSpace,
    onSelectSpace,
    selectedSpaceId,
    compact,
}: SpaceTreeNodeProps) {
    const [expanded, setExpanded] = useState(depth < 2);
    const hasChildren = space.children && space.children.length > 0;
    const config = SPACE_TYPE_CONFIG[space.type] || SPACE_TYPE_CONFIG.ROOM;
    const Icon = config.icon;
    const isSelected = selectedSpaceId === space.id;

    // Count assets in this space
    const spaceAssets = assets.filter((a) => a.spaceId === space.id);

    const handleClick = useCallback(() => {
        if (onSelectSpace) {
            onSelectSpace(space);
        }
        if (hasChildren) {
            setExpanded((prev) => !prev);
        }
    }, [onSelectSpace, space, hasChildren]);

    return (
        <div role="treeitem" aria-expanded={hasChildren ? expanded : undefined}>
            <div
                className={cn(
                    "group flex items-center gap-1.5 rounded-lg transition-colors cursor-pointer",
                    compact ? "px-2 py-1.5" : "px-3 py-2",
                    isSelected
                        ? "bg-primary/10 border border-primary/20"
                        : "hover:bg-muted/50 border border-transparent"
                )}
                style={{ paddingLeft: `${depth * (compact ? 16 : 20) + (compact ? 8 : 12)}px` }}
                onClick={handleClick}
            >
                {/* Expand/collapse toggle */}
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        setExpanded((prev) => !prev);
                    }}
                    className={cn(
                        "shrink-0 p-0.5 rounded transition-colors",
                        hasChildren ? "text-muted-foreground hover:text-foreground" : "invisible"
                    )}
                    aria-label={expanded ? "Collapse" : "Expand"}
                    tabIndex={-1}
                >
                    {expanded ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                    )}
                </button>

                {/* Icon */}
                <Icon className={cn("h-4 w-4 shrink-0", config.color)} aria-hidden="true" />

                {/* Name */}
                <span className={cn(
                    "flex-1 text-sm truncate",
                    isSelected ? "font-medium text-foreground" : "text-foreground"
                )}>
                    {space.name}
                </span>

                {/* Asset count badge */}
                {spaceAssets.length > 0 && (
                    <Badge variant="default" size="sm">
                        <Cpu className="h-3 w-3 mr-0.5" aria-hidden="true" />
                        {spaceAssets.length}
                    </Badge>
                )}

                {/* Type badge */}
                {!compact && (
                    <span className="hidden sm:inline text-xs text-muted-foreground">
                        {config.label}
                    </span>
                )}

                {/* Actions (visible on hover) */}
                {!compact && (
                    <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onAddSpace(space.id);
                            }}
                            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                            aria-label={`Add child space to ${space.name}`}
                            title="Add child space"
                        >
                            <Plus className="h-3.5 w-3.5" />
                        </button>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onEditSpace(space);
                            }}
                            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                            aria-label={`Edit ${space.name}`}
                            title="Edit"
                        >
                            <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onDeleteSpace(space);
                            }}
                            className="p-1 rounded text-muted-foreground hover:text-danger hover:bg-danger/10 transition-colors"
                            aria-label={`Delete ${space.name}`}
                            title="Delete"
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                        </button>
                    </div>
                )}
            </div>

            {/* Children */}
            {expanded && hasChildren && (
                <div role="group">
                    {space.children.map((child) => (
                        <SpaceTreeNode
                            key={child.id}
                            space={child}
                            assets={assets}
                            depth={depth + 1}
                            onAddSpace={onAddSpace}
                            onEditSpace={onEditSpace}
                            onDeleteSpace={onDeleteSpace}
                            onSelectSpace={onSelectSpace}
                            selectedSpaceId={selectedSpaceId}
                            compact={compact}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
