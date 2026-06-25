"use client";

import { useState } from "react";
import { cn } from "@/lib/utils/cn";
import type { DashboardWidget } from "@/lib/api/types";
import { X, ChevronUp, ChevronDown } from "lucide-react";
import { WIDGET_META } from "./widget-meta";
import { WidgetPreviewPlaceholder } from "./WidgetPreviewPlaceholder";

// ─── Widget card ────────────────────────────────────────────────────────────

interface WidgetCardProps {
    widget: DashboardWidget;
    isSelected: boolean;
    isFirst: boolean;
    isLast: boolean;
    onSelect: () => void;
    onRemove: () => void;
    onMoveUp: () => void;
    onMoveDown: () => void;
}

export function WidgetCard({
    widget,
    isSelected,
    isFirst,
    isLast,
    onSelect,
    onRemove,
    onMoveUp,
    onMoveDown,
}: WidgetCardProps) {
    const [hovering, setHovering] = useState(false);
    const meta = WIDGET_META[widget.type] ?? WIDGET_META.stat_card;
    const Icon = meta.icon;

    return (
        <div
            onClick={(e) => { e.stopPropagation(); onSelect(); }}
            onMouseEnter={() => setHovering(true)}
            onMouseLeave={() => setHovering(false)}
            style={{
                gridColumn: `span ${widget.position?.colSpan || 1}`,
                gridRow: `span ${widget.position?.rowSpan || 1}`,
            }}
            className={cn(
                "relative rounded-lg border-2 bg-card p-3 cursor-pointer transition-all min-h-[100px]",
                isSelected
                    ? "border-primary shadow-md shadow-primary/10"
                    : "border-border hover:border-primary/40"
            )}
        >
            {/* Header */}
            <div className="flex items-center gap-2 mb-2">
                <Icon className={cn("h-4 w-4 shrink-0", meta.color)} />
                <span className="text-xs font-medium text-foreground truncate flex-1">
                    {widget.title || "Untitled"}
                </span>
                <span className="text-[10px] text-muted-foreground/60 shrink-0">
                    {meta.label}
                </span>
            </div>

            {/* Preview placeholder */}
            <WidgetPreviewPlaceholder type={widget.type} />

            {/* Span badge */}
            {(widget.position?.colSpan > 1 || widget.position?.rowSpan > 1) && (
                <div className="absolute bottom-1.5 left-3 text-[10px] text-muted-foreground/50">
                    {widget.position.colSpan}×{widget.position.rowSpan}
                </div>
            )}

            {/* Hover/selected controls */}
            {(hovering || isSelected) && (
                <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5">
                    {!isFirst && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onMoveUp(); }}
                            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                            title="Move up"
                        >
                            <ChevronUp className="h-3 w-3" />
                        </button>
                    )}
                    {!isLast && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onMoveDown(); }}
                            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                            title="Move down"
                        >
                            <ChevronDown className="h-3 w-3" />
                        </button>
                    )}
                    <button
                        onClick={(e) => { e.stopPropagation(); onRemove(); }}
                        className="p-1 rounded text-muted-foreground hover:text-danger hover:bg-danger/10 transition-colors"
                        title="Remove widget"
                    >
                        <X className="h-3 w-3" />
                    </button>
                </div>
            )}
        </div>
    );
}
