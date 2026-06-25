"use client";

/**
 * ObjectLinksPanel — ADR-011 Phase C
 *
 * Orchestrator that displays and manages all links for a selected graph object.
 * Delegates to AddLinkForm, LinkGroup, and CreateLinkTypeForm.
 * Link types are fetched from the database — nothing is hardcoded.
 */

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { AddLinkForm } from "./AddLinkForm";
import { LinkGroup } from "./LinkGroup";
import { useObjectLinks, useSiteObjects, useLinkTypes } from "@/lib/hooks/useGraph";
import { ArrowRight, ArrowLeft, Link2, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface ObjectLinksPanelProps {
    objectId: string;
    objectName: string;
    siteId: string;
    className?: string;
}

export function ObjectLinksPanel({ objectId, objectName, siteId, className }: ObjectLinksPanelProps) {
    const { outbound, inbound, loading, error, addLink, removeLink } = useObjectLinks(objectId);
    const { objects: siteObjects, loading: objectsLoading } = useSiteObjects(siteId);
    const { linkTypes, loading: typesLoading, addLinkType } = useLinkTypes();
    const [showAddForm, setShowAddForm] = useState(false);

    async function handleAddLink(data: { sourceId: string; targetId: string; linkTypeName: string }) {
        await addLink(data);
        setShowAddForm(false);
    }

    if (loading) {
        return (
            <div className={cn("flex items-center justify-center py-8", className)}>
                <LoadingSpinner />
            </div>
        );
    }

    if (error) {
        return <p className={cn("text-sm text-danger", className)}>{error}</p>;
    }

    return (
        <div className={cn("space-y-4", className)}>
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Link2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    <span className="text-sm font-medium text-foreground">
                        Links for <span className="text-primary">{objectName}</span>
                    </span>
                    <Badge variant="default" size="sm">{outbound.length + inbound.length}</Badge>
                </div>
                <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setShowAddForm((p) => !p)}
                >
                    {showAddForm
                        ? <><X className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />Cancel</>
                        : <><Plus className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />Add Link</>
                    }
                </Button>
            </div>

            {showAddForm && (
                <AddLinkForm
                    objectId={objectId}
                    objectName={objectName}
                    siteObjects={siteObjects}
                    objectsLoading={objectsLoading}
                    linkTypes={linkTypes}
                    typesLoading={typesLoading}
                    onSubmit={handleAddLink}
                    onCancel={() => setShowAddForm(false)}
                    addLinkType={addLinkType}
                />
            )}

            <LinkGroup
                title="Outbound"
                icon={<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />}
                links={outbound}
                thisSide="source"
                onRemove={removeLink}
            />

            <LinkGroup
                title="Inbound"
                icon={<ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />}
                links={inbound}
                thisSide="target"
                onRemove={removeLink}
            />

            {outbound.length === 0 && inbound.length === 0 && !showAddForm && (
                <p className="text-sm text-muted-foreground text-center py-4">
                    No links yet. Add one above to connect this object to the graph.
                </p>
            )}
        </div>
    );
}
