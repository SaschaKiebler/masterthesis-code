import { cn } from "@/lib/utils/cn";
import { BarChart3, LineChart, Gauge, BookmarkPlus, Plus, Sparkles } from "lucide-react";

// ─── Empty state ────────────────────────────────────────────────────────────

export function EmptyGrid({
    dragOver,
    onAddClick,
    onApplyTemplate,
    onAiAssistant,
}: {
    dragOver: boolean;
    onAddClick: () => void;
    onApplyTemplate?: () => void;
    onAiAssistant?: () => void;
}) {
    return (
        <div
            className={cn(
                "flex flex-col items-center justify-center h-full w-full border-2 border-dashed rounded-xl transition-colors",
                dragOver
                    ? "border-primary bg-primary/5"
                    : "border-border text-muted-foreground"
            )}
        >
            <div className="flex gap-2 mb-3">
                <BarChart3 className="h-8 w-8 text-muted-foreground/30" />
                <LineChart className="h-8 w-8 text-muted-foreground/30" />
                <Gauge className="h-8 w-8 text-muted-foreground/30" />
            </div>
            <p className="text-sm font-medium text-foreground mb-1">Start building your dashboard</p>
            <p className="text-xs text-muted-foreground mb-4">Drag assets from the left panel, add widgets, or apply a saved template.</p>
            <div className="flex items-center gap-2">
                {onAiAssistant && (
                    <button
                        type="button"
                        onClick={onAiAssistant}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-primary-foreground bg-primary hover:bg-primary/90 transition-colors"
                    >
                        <Sparkles className="h-3.5 w-3.5" />
                        AI Assistant
                    </button>
                )}
                {onApplyTemplate && (
                    <button
                        type="button"
                        onClick={onApplyTemplate}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-primary bg-primary/10 hover:bg-primary/20 transition-colors"
                    >
                        <BookmarkPlus className="h-3.5 w-3.5" />
                        Apply Template
                    </button>
                )}
                <button
                    type="button"
                    onClick={onAddClick}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground bg-muted/50 hover:bg-muted transition-colors"
                >
                    <Plus className="h-3.5 w-3.5" />
                    Add Widget
                </button>
            </div>
        </div>
    );
}
