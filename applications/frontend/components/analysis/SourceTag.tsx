"use client";

import { X } from "lucide-react";
import type { ChartSource } from "@/lib/api/analysis";
import { ColorSwatchPicker } from "./ColorSwatchPicker";

interface SourceTagProps {
    source: ChartSource;
    onRemove: () => void;
    onColorChange: (color: string) => void;
}

export function SourceTag({ source, onRemove, onColorChange }: SourceTagProps) {
    return (
        <span
            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-foreground"
            style={{ borderLeft: `3px solid ${source.color}` }}
        >
            <ColorSwatchPicker color={source.color} onChange={onColorChange} />
            {source.label}
            <button
                onClick={onRemove}
                className="text-muted-foreground hover:text-foreground ml-0.5"
            >
                <X className="w-3 h-3" />
            </button>
        </span>
    );
}
