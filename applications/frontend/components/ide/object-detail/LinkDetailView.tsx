"use client";

import { useState, useCallback } from "react";
import { ArrowRight, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { GraphLink, GraphObject } from "@/lib/api/types";
import { Section, InfoRow } from "./Section";

// ─── Link detail view (when edge is selected) ────────────────────────────────

export interface LinkDetailViewProps {
    link: GraphLink;
    allObjects: GraphObject[];
    onDeleteLink: (linkId: string) => Promise<void>;
    onSelectObject: (object: GraphObject | null) => void;
}

export function LinkDetailView({ link, allObjects, onDeleteLink, onSelectObject }: LinkDetailViewProps) {
    const [deleting, setDeleting] = useState(false);

    const handleDelete = useCallback(async () => {
        setDeleting(true);
        try { await onDeleteLink(link.id); } catch { setDeleting(false); }
    }, [link.id, onDeleteLink]);

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <div className="flex-1 overflow-y-auto">
                <div className="px-4 pt-4 pb-3 border-b border-border">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Link</p>
                    <p className="text-sm font-semibold text-foreground mt-1">
                        {link.linkTypeDisplayName || link.linkTypeName}
                    </p>
                </div>

                <Section title="Connection">
                    <div className="flex items-center gap-2 py-1">
                        <button
                            onClick={() => {
                                const src = allObjects.find((o) => o.id === link.sourceId);
                                if (src) onSelectObject(src);
                            }}
                            className="text-sm text-foreground hover:text-primary transition-colors truncate"
                        >
                            {link.sourceName}
                        </button>
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <button
                            onClick={() => {
                                const tgt = allObjects.find((o) => o.id === link.targetId);
                                if (tgt) onSelectObject(tgt);
                            }}
                            className="text-sm text-foreground hover:text-primary transition-colors truncate"
                        >
                            {link.targetName}
                        </button>
                    </div>
                    <InfoRow label="Source Type" value={link.sourceTypeName} />
                    <InfoRow label="Target Type" value={link.targetTypeName} />
                    <InfoRow label="Link Type" value={link.linkTypeName} />
                </Section>
            </div>

            <div className="border-t border-border px-4 py-3 shrink-0">
                <Button size="sm" variant="danger" onClick={handleDelete} loading={deleting}>
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete Link
                </Button>
            </div>
        </div>
    );
}
