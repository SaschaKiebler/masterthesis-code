"use client";

/**
 * EditorGridPreview — center panel of the Dashboard Editor.
 * Visual CSS grid showing widget placeholders. Drop target for assets.
 * Click to select a widget, hover to show delete/move controls.
 */

import { useState, useCallback, useRef } from "react";
import { cn } from "@/lib/utils/cn";
import type { DashboardLayout } from "@/lib/api/types";
import type { DraggedAsset } from "./useEditorState";
import { Plus } from "lucide-react";
import { WidgetCard } from "./grid-preview/WidgetCard";
import { EmptyGrid } from "./grid-preview/EmptyGrid";

// ─── Props ──────────────────────────────────────────────────────────────────

interface EditorGridPreviewProps {
    layout: DashboardLayout;
    selectedWidgetId: string | null;
    onSelectWidget: (widgetId: string | null) => void;
    onDropAsset: (asset: DraggedAsset, col: number) => void;
    onRemoveWidget: (widgetId: string) => void;
    onMoveWidget: (widgetId: string, direction: "up" | "down") => void;
    onSetColumns: (columns: number) => void;
    onAddWidgetClick: () => void;
    onApplyTemplate?: () => void;
    onAiAssistant?: () => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function EditorGridPreview({
    layout,
    selectedWidgetId,
    onSelectWidget,
    onDropAsset,
    onRemoveWidget,
    onMoveWidget,
    onSetColumns,
    onAddWidgetClick,
    onApplyTemplate,
    onAiAssistant,
}: EditorGridPreviewProps) {
    const [dragOver, setDragOver] = useState(false);
    const gridRef = useRef<HTMLDivElement>(null);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDragOver(true);
    }, []);

    const handleDragLeave = useCallback(() => {
        setDragOver(false);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);

        try {
            const raw = e.dataTransfer.getData("application/json");
            if (!raw) return;
            const asset: DraggedAsset = JSON.parse(raw);

            // Estimate column from drop position
            const rect = gridRef.current?.getBoundingClientRect();
            let col = 0;
            if (rect) {
                const relX = e.clientX - rect.left;
                col = Math.floor((relX / rect.width) * layout.columns);
                col = Math.max(0, Math.min(col, layout.columns - 1));
            }

            onDropAsset(asset, col);
        } catch {
            // Invalid drag data
        }
    }, [layout.columns, onDropAsset]);

    const handleBackgroundClick = useCallback((e: React.MouseEvent) => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).dataset?.role === "grid-bg") {
            onSelectWidget(null);
        }
    }, [onSelectWidget]);

    return (
        <div className="flex flex-col h-full overflow-hidden bg-background">
            {/* Toolbar */}
            <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-card shrink-0">
                <span className="text-xs text-muted-foreground">Columns:</span>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                    <button
                        key={n}
                        onClick={() => onSetColumns(n)}
                        className={cn(
                            "h-7 w-7 rounded text-xs font-medium transition-colors",
                            layout.columns === n
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-muted-foreground hover:text-foreground"
                        )}
                    >
                        {n}
                    </button>
                ))}
                <div className="flex-1" />
                <span className="text-xs text-muted-foreground">
                    {layout.widgets.length} widget{layout.widgets.length !== 1 ? "s" : ""}
                </span>
            </div>

            {/* Grid area */}
            <div
                ref={gridRef}
                className={cn(
                    "flex-1 overflow-y-auto p-6",
                    dragOver && "ring-2 ring-primary/40 ring-inset bg-primary/5"
                )}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={handleBackgroundClick}
            >
                {layout.widgets.length === 0 ? (
                    <EmptyGrid dragOver={dragOver} onAddClick={onAddWidgetClick} onApplyTemplate={onApplyTemplate} onAiAssistant={onAiAssistant} />
                ) : (
                    <div
                        className="grid gap-4"
                        style={{
                            gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
                        }}
                        data-role="grid-bg"
                    >
                        {layout.widgets.map((widget, idx) => (
                            <WidgetCard
                                key={widget.id}
                                widget={widget}
                                isSelected={widget.id === selectedWidgetId}
                                isFirst={idx === 0}
                                isLast={idx === layout.widgets.length - 1}
                                onSelect={() => onSelectWidget(widget.id)}
                                onRemove={() => onRemoveWidget(widget.id)}
                                onMoveUp={() => onMoveWidget(widget.id, "up")}
                                onMoveDown={() => onMoveWidget(widget.id, "down")}
                            />
                        ))}

                        {/* Drop zone / click-to-add placeholder at end */}
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onAddWidgetClick(); }}
                            className={cn(
                                "border-2 border-dashed rounded-lg flex items-center justify-center min-h-[80px] transition-colors cursor-pointer",
                                dragOver
                                    ? "border-primary/60 bg-primary/5"
                                    : "border-border/50 text-muted-foreground/40 hover:border-primary/40 hover:text-muted-foreground/70 hover:bg-muted/30"
                            )}
                        >
                            <Plus className="h-5 w-5" />
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
