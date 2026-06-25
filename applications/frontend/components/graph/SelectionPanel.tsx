"use client";

/**
 * SelectionPanel — contextual detail panel shown when a node or edge
 * is selected in the visual graph editor. Allows editing names and deleting.
 */

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { GraphObject, GraphLink } from "@/lib/api/types";
import { Pencil, Trash2, X, ArrowRight } from "lucide-react";

// ─── Node detail ──────────────────────────────────────────────────────────────

interface NodeDetailProps {
    object: GraphObject;
    onUpdateName: (objectId: string, displayName: string) => Promise<void>;
    onClose: () => void;
}

export function NodeDetail({ object, onUpdateName, onClose }: NodeDetailProps) {
    const [editing, setEditing] = useState(false);
    const [name, setName] = useState(object.displayName);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleSave() {
        if (!name.trim() || name.trim() === object.displayName) {
            setEditing(false);
            return;
        }
        setSaving(true);
        setError(null);
        try {
            await onUpdateName(object.id, name.trim());
            setEditing(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to update");
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="bg-card border border-border rounded-xl shadow-lg p-4 w-72 space-y-3">
            <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {object.objectTypeDisplayName}
                </p>
                <button
                    onClick={onClose}
                    className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>

            {editing ? (
                <div className="space-y-2">
                    <Input
                        label="Display Name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        error={error ?? undefined}
                        autoFocus
                        onKeyDown={(e) => {
                            if (e.key === "Enter") handleSave();
                            if (e.key === "Escape") { setEditing(false); setName(object.displayName); }
                        }}
                    />
                    <div className="flex gap-2">
                        <Button size="sm" onClick={handleSave} loading={saving} disabled={!name.trim()}>
                            Save
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setName(object.displayName); }}>
                            Cancel
                        </Button>
                    </div>
                </div>
            ) : (
                <div className="space-y-2">
                    <p className="text-sm font-medium text-foreground">{object.displayName}</p>
                    <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">{object.objectTypeName}</span>
                        <span className="text-xs text-muted-foreground/50">|</span>
                        <span className="text-xs text-muted-foreground">{object.objectTypeCategory}</span>
                    </div>
                    <p className="font-mono text-[10px] text-muted-foreground/60 break-all">{object.id}</p>
                </div>
            )}

            {!editing && (
                <div className="flex gap-2 pt-1 border-t border-border/50">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                        <Pencil className="h-3.5 w-3.5 mr-1.5" /> Rename
                    </Button>
                </div>
            )}
        </div>
    );
}

// ─── Edge detail ──────────────────────────────────────────────────────────────

interface EdgeDetailProps {
    link: GraphLink;
    onDelete: (linkId: string) => Promise<void>;
    onClose: () => void;
}

export function EdgeDetail({ link, onDelete, onClose }: EdgeDetailProps) {
    const [deleting, setDeleting] = useState(false);

    async function handleDelete() {
        setDeleting(true);
        try {
            await onDelete(link.id);
            onClose();
        } catch {
            setDeleting(false);
        }
    }

    return (
        <div className="bg-card border border-border rounded-xl shadow-lg p-4 w-72 space-y-3">
            <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {link.linkTypeDisplayName || link.linkTypeName}
                </p>
                <button
                    onClick={onClose}
                    className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>

            <div className="flex items-center gap-2 text-sm">
                <span className="font-medium text-foreground truncate">{link.sourceName}</span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="font-medium text-foreground truncate">{link.targetName}</span>
            </div>

            <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">{link.sourceTypeName}</span>
                <span className="text-xs text-muted-foreground/50">→</span>
                <span className="text-xs text-muted-foreground">{link.targetTypeName}</span>
            </div>

            <p className="font-mono text-[10px] text-muted-foreground/60 break-all">{link.id}</p>

            <div className="pt-1 border-t border-border/50">
                <Button size="sm" variant="danger" onClick={handleDelete} loading={deleting}>
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete Link
                </Button>
            </div>
        </div>
    );
}
