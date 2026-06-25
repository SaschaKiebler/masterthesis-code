"use client";

/**
 * AddLinkForm — form to create a new link between two objects.
 * Link types are fetched from the DB. Users can define new types inline.
 */

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { CreateLinkTypeForm } from "./CreateLinkTypeForm";
import type { GraphObject, ApiLinkType, CreateLinkRequest, CreateLinkTypeRequest } from "@/lib/api/types";
import { Sparkles, ChevronDown, ChevronUp } from "lucide-react";

interface AddLinkFormProps {
    objectId: string;
    objectName: string;
    siteObjects: GraphObject[];
    objectsLoading: boolean;
    linkTypes: ApiLinkType[];
    typesLoading: boolean;
    onSubmit: (data: CreateLinkRequest) => Promise<void>;
    onCancel: () => void;
    addLinkType: (data: CreateLinkTypeRequest) => Promise<{ name: string }>;
}

export function AddLinkForm({
    objectId,
    objectName,
    siteObjects,
    objectsLoading,
    linkTypes,
    typesLoading,
    onSubmit,
    onCancel,
    addLinkType,
}: AddLinkFormProps) {
    const [direction, setDirection] = useState<"outbound" | "inbound">("outbound");
    const [linkTypeName, setLinkTypeName] = useState("");
    const [targetId, setTargetId] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showCreateType, setShowCreateType] = useState(false);

    // Sync linkTypeName to first available type once they load
    useEffect(() => {
        if (linkTypes.length > 0 && !linkTypeName) {
            setLinkTypeName(linkTypes[0].name);
        }
    }, [linkTypes, linkTypeName]);

    const otherObjects = siteObjects.filter((o) => o.id !== objectId);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!targetId || !linkTypeName) return;

        setSubmitting(true);
        setError(null);
        try {
            const sourceId = direction === "outbound" ? objectId : targetId;
            const tgtId    = direction === "outbound" ? targetId : objectId;
            await onSubmit({ sourceId, targetId: tgtId, linkTypeName });
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to create link");
        } finally {
            setSubmitting(false);
        }
    }

    function handleLinkTypeCreated(name: string) {
        setLinkTypeName(name);
        setShowCreateType(false);
    }

    return (
        <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-4 space-y-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">New Link</p>

            <form onSubmit={handleSubmit} className="space-y-3">
                {/* Direction */}
                <Select
                    label="Direction"
                    value={direction}
                    onChange={(e) => setDirection(e.target.value as "outbound" | "inbound")}
                >
                    <option value="outbound">{objectName} → [other]</option>
                    <option value="inbound">[other] → {objectName}</option>
                </Select>

                {/* Link type — from DB */}
                <div className="space-y-1.5">
                    <Select
                        label="Link Type"
                        value={linkTypeName}
                        onChange={(e) => setLinkTypeName(e.target.value)}
                        disabled={typesLoading}
                    >
                        {typesLoading ? (
                            <option value="">Loading types…</option>
                        ) : linkTypes.length === 0 ? (
                            <option value="">No link types defined</option>
                        ) : (
                            linkTypes.map((lt) => (
                                <option key={lt.name} value={lt.name}>
                                    {lt.displayName}
                                    {lt.description ? ` — ${lt.description}` : ""}
                                </option>
                            ))
                        )}
                    </Select>

                    <button
                        type="button"
                        onClick={() => setShowCreateType((p) => !p)}
                        className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
                    >
                        <Sparkles className="h-3 w-3" aria-hidden="true" />
                        {showCreateType ? "Cancel new type" : "Define a new link type…"}
                        {showCreateType ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </button>
                </div>

                {/* Target object */}
                <Select
                    label={direction === "outbound" ? "Target Object" : "Source Object"}
                    value={targetId}
                    onChange={(e) => setTargetId(e.target.value)}
                    required
                    error={error ?? undefined}
                >
                    <option value="">
                        {objectsLoading ? "Loading…" : "Select an object…"}
                    </option>
                    {otherObjects.map((o) => (
                        <option key={o.id} value={o.id}>
                            {o.displayName} ({o.objectTypeDisplayName})
                        </option>
                    ))}
                </Select>

                <div className="flex gap-2">
                    <Button
                        type="submit"
                        size="sm"
                        loading={submitting}
                        disabled={!targetId || !linkTypeName}
                    >
                        Create Link
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
                        Cancel
                    </Button>
                </div>
            </form>

            {/* Inline: define new link type */}
            {showCreateType && (
                <CreateLinkTypeForm
                    onCreated={handleLinkTypeCreated}
                    onCancel={() => setShowCreateType(false)}
                    addLinkType={addLinkType}
                />
            )}
        </div>
    );
}
