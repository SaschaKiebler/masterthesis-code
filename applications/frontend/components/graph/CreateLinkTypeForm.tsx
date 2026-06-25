"use client";

/**
 * CreateLinkTypeForm — inline form to define a new link type on the fly.
 * On success, calls onCreated with the new type's name so the parent can
 * auto-select it in the link-type dropdown.
 */

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Sparkles } from "lucide-react";
import type { CreateLinkTypeRequest } from "@/lib/api/types";

interface CreateLinkTypeFormProps {
    onCreated: (name: string) => void;
    onCancel: () => void;
    addLinkType: (data: CreateLinkTypeRequest) => Promise<{ name: string }>;
}

export function CreateLinkTypeForm({ onCreated, onCancel, addLinkType }: CreateLinkTypeFormProps) {
    const [name, setName] = useState("");
    const [displayName, setDisplayName] = useState("");
    const [description, setDescription] = useState("");
    const [inverseName, setInverseName] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!name.trim() || !displayName.trim()) return;

        setSubmitting(true);
        setError(null);
        try {
            const created = await addLinkType({
                name: name.trim(),
                displayName: displayName.trim(),
                description: description.trim() || undefined,
                inverseName: inverseName.trim() || undefined,
            });
            onCreated(created.name);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to create link type");
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <form onSubmit={handleSubmit} className="border-t border-border/60 pt-4 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                Define New Link Type
            </p>

            <div className="grid grid-cols-2 gap-3">
                <Input
                    label="Machine name"
                    placeholder="e.g. HEATS"
                    value={name}
                    onChange={(e) => setName(e.target.value.toUpperCase().replace(/\s+/g, "_"))}
                    required
                    helperText="UPPER_SNAKE_CASE, unique"
                />
                <Input
                    label="Display name"
                    placeholder="e.g. Heats"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    required
                />
            </div>

            <Input
                label="Description"
                placeholder="Optional: what does this relationship mean?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
            />

            <Input
                label="Inverse name"
                placeholder="e.g. HEATED_BY (optional)"
                value={inverseName}
                onChange={(e) => setInverseName(e.target.value.toUpperCase().replace(/\s+/g, "_"))}
                helperText="The reverse direction label"
            />

            {error && <p className="text-sm text-danger" role="alert">{error}</p>}

            <div className="flex gap-2">
                <Button
                    type="submit"
                    size="sm"
                    variant="secondary"
                    loading={submitting}
                    disabled={!name.trim() || !displayName.trim()}
                >
                    <Sparkles className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
                    Save Link Type
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
                    Cancel
                </Button>
            </div>
        </form>
    );
}
