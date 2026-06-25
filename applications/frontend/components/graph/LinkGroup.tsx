"use client";

/**
 * LinkGroup — renders a list of graph links (outbound or inbound) with
 * type badge, neighbour name, and hover-reveal delete button.
 */

import type { GraphLink } from "@/lib/api/types";
import { Unlink } from "lucide-react";
import { cn } from "@/lib/utils/cn";

const CATEGORY_COLOR: Record<string, string> = {
    STRUCTURE: "text-blue-500",
    SPACE:     "text-emerald-500",
    DEVICE:    "text-amber-500",
    SYSTEM:    "text-purple-500",
    CONTACT:   "text-pink-500",
};

interface LinkGroupProps {
    title: string;
    icon: React.ReactNode;
    links: GraphLink[];
    thisSide: "source" | "target";
    onRemove: (linkId: string) => void;
}

export function LinkGroup({ title, icon, links, thisSide, onRemove }: LinkGroupProps) {
    if (links.length === 0) return null;

    return (
        <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {icon}
                {title}
                <span className="text-foreground/60">({links.length})</span>
            </div>

            <ul className="space-y-1" role="list">
                {links.map((link) => {
                    const other = thisSide === "source"
                        ? { id: link.targetId, name: link.targetName, type: link.targetTypeName }
                        : { id: link.sourceId, name: link.sourceName, type: link.sourceTypeName };

                    const typeColor = CATEGORY_COLOR[other.type?.toUpperCase() ?? ""] ?? "text-muted-foreground";

                    return (
                        <li
                            key={link.id}
                            className="group flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-muted/50 transition-colors"
                        >
                            <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-xs font-mono text-muted-foreground">
                                {link.linkTypeDisplayName || link.linkTypeName}
                            </span>

                            <span className={cn("flex-1 text-sm truncate font-medium", typeColor)}>
                                {other.name}
                            </span>
                            <span className="text-xs text-muted-foreground hidden sm:inline shrink-0">
                                {other.type}
                            </span>

                            <button
                                onClick={() => onRemove(link.id)}
                                className="hidden group-hover:flex items-center justify-center p-1 rounded text-muted-foreground hover:text-danger hover:bg-danger/10 transition-colors shrink-0"
                                aria-label={`Remove ${link.linkTypeName} link to ${other.name}`}
                                title="Remove link"
                            >
                                <Unlink className="h-3.5 w-3.5" />
                            </button>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
