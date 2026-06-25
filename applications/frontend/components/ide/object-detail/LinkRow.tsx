"use client";

import { useState } from "react";
import { ArrowRight, ArrowLeft, X } from "lucide-react";
import type { GraphLink } from "@/lib/api/types";

// ─── Single link row ──────────────────────────────────────────────────────────

export interface LinkRowProps {
    link: GraphLink;
    direction: "inbound" | "outbound";
    onDelete: () => void;
    onNavigate: () => void;
}

export function LinkRow({ link, direction, onDelete, onNavigate }: LinkRowProps) {
    const [hovering, setHovering] = useState(false);
    const isOut = direction === "outbound";
    const neighbourName = isOut ? link.targetName : link.sourceName;

    return (
        <div
            className="flex items-center gap-2 py-1 group"
            onMouseEnter={() => setHovering(true)}
            onMouseLeave={() => setHovering(false)}
        >
            {isOut ? (
                <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
            ) : (
                <ArrowLeft className="h-3 w-3 text-muted-foreground shrink-0" />
            )}
            <span className="text-[10px] text-muted-foreground/70 uppercase w-20 truncate shrink-0">
                {link.linkTypeDisplayName || link.linkTypeName}
            </span>
            <button
                onClick={onNavigate}
                className="text-xs text-foreground hover:text-primary transition-colors truncate flex-1 text-left"
            >
                {neighbourName}
            </button>
            {hovering && (
                <button
                    onClick={(e) => { e.stopPropagation(); onDelete(); }}
                    className="p-0.5 rounded text-muted-foreground hover:text-danger hover:bg-danger/10 transition-colors shrink-0"
                    title="Delete link"
                >
                    <X className="h-3 w-3" />
                </button>
            )}
        </div>
    );
}
