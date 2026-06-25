"use client";

import { useState } from "react";
import { Plus, ChevronDown } from "lucide-react";
import type { AnalysisView } from "@/lib/api/analysis";

interface ViewSelectorProps {
    viewName: string;
    activeViewId: string | null;
    savedViews: AnalysisView[];
    onRename: (name: string) => void;
    onLoad: (view: AnalysisView) => void;
    onNew: () => void;
}

export function ViewSelector({
    viewName,
    activeViewId,
    savedViews,
    onRename,
    onLoad,
    onNew,
}: ViewSelectorProps) {
    const [open, setOpen] = useState(false);

    return (
        <div className="relative">
            <button
                onClick={() => setOpen(!open)}
                className="flex items-center gap-2 px-3 py-2 bg-card border border-input rounded-lg text-sm font-medium text-foreground hover:bg-muted transition-colors"
            >
                <input
                    value={viewName}
                    onChange={(e) => onRename(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="bg-transparent outline-none w-48 text-foreground"
                    placeholder="Analysis name..."
                />
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
            </button>

            {open && (
                <div className="absolute z-50 top-full left-0 mt-1 w-72 bg-card border border-input rounded-lg shadow-lg overflow-hidden">
                    <button
                        onClick={() => { onNew(); setOpen(false); }}
                        className="w-full px-3 py-2 text-left text-sm text-primary hover:bg-muted transition-colors flex items-center gap-2 border-b border-input"
                    >
                        <Plus className="w-4 h-4" />
                        New Analysis
                    </button>
                    {savedViews.length === 0 ? (
                        <p className="px-3 py-3 text-sm text-muted-foreground text-center">
                            No saved analyses yet
                        </p>
                    ) : (
                        savedViews.map((view) => (
                            <button
                                key={view.id}
                                onClick={() => { onLoad(view); setOpen(false); }}
                                className={`w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors ${
                                    view.id === activeViewId ? "bg-muted font-medium" : ""
                                }`}
                            >
                                {view.name}
                            </button>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}
