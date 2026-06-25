"use client";

import { useState, useCallback, useMemo } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { GraphObject, ApiLinkType, CreateLinkRequest } from "@/lib/api/types";

// ─── Inline add link form ─────────────────────────────────────────────────────

export interface AddLinkInlineProps {
    sourceObject: GraphObject;
    allObjects: GraphObject[];
    linkTypes: ApiLinkType[];
    onCreateLink: (data: CreateLinkRequest) => Promise<void>;
    onClose: () => void;
}

export function AddLinkInline({ sourceObject, allObjects, linkTypes, onCreateLink, onClose }: AddLinkInlineProps) {
    const [targetId, setTargetId] = useState("");
    const [linkTypeName, setLinkTypeName] = useState(linkTypes[0]?.name ?? "");
    const [creating, setCreating] = useState(false);

    const targets = useMemo(
        () => allObjects.filter((o) => o.id !== sourceObject.id).sort((a, b) => a.displayName.localeCompare(b.displayName)),
        [allObjects, sourceObject.id]
    );

    const handleCreate = useCallback(async () => {
        if (!targetId || !linkTypeName) return;
        setCreating(true);
        try {
            await onCreateLink({ sourceId: sourceObject.id, targetId, linkTypeName });
            onClose();
        } catch { /* handled upstream */ }
        finally { setCreating(false); }
    }, [sourceObject.id, targetId, linkTypeName, onCreateLink, onClose]);

    return (
        <div className="p-2 mb-2 bg-background border border-border rounded-lg space-y-2">
            <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-foreground">Add Link</p>
                <button onClick={onClose} className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors">
                    <X className="h-3 w-3" />
                </button>
            </div>
            <select
                value={linkTypeName}
                onChange={(e) => setLinkTypeName(e.target.value)}
                className="w-full h-7 px-2 text-xs bg-background border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
                {linkTypes.map((lt) => (
                    <option key={lt.name} value={lt.name}>{lt.displayName}</option>
                ))}
            </select>
            <select
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                className="w-full h-7 px-2 text-xs bg-background border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
                <option value="">Select target...</option>
                {targets.map((t) => (
                    <option key={t.id} value={t.id}>{t.displayName} ({t.objectTypeName})</option>
                ))}
            </select>
            <div className="flex gap-1.5">
                <Button size="sm" onClick={handleCreate} disabled={!targetId || !linkTypeName} loading={creating}>
                    Create
                </Button>
                <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
            </div>
        </div>
    );
}
