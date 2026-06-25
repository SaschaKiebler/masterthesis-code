/**
 * Link Type List
 * Table/card view of link types with create for system admins
 * Client component — manages list state
 */

"use client";

import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { SiteCardSkeleton } from "@/components/ui/Skeleton";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { useLinkTypes } from "@/lib/hooks/useGraph";
import { LinkTypeModal } from "@/components/templates/LinkTypeModal";
import type { ApiLinkType } from "@/lib/api/types";
import {
    Search,
    Link2,
    ArrowLeftRight,
    Plus,
} from "lucide-react";

interface LinkTypeListProps {
    showCreate: boolean;
    onShowCreateChange: (show: boolean) => void;
    canManage: boolean;
}

export function LinkTypeList({ showCreate, onShowCreateChange, canManage }: LinkTypeListProps) {
    const { linkTypes, loading, error, refresh } = useLinkTypes();

    const [searchQuery, setSearchQuery] = useState("");

    // Filter
    const filteredTypes = useMemo(() => {
        if (!searchQuery.trim()) return linkTypes;
        const q = searchQuery.toLowerCase();
        return linkTypes.filter(
            (lt) =>
                lt.name.toLowerCase().includes(q) ||
                lt.displayName.toLowerCase().includes(q) ||
                (lt.description && lt.description.toLowerCase().includes(q)) ||
                (lt.inverseName && lt.inverseName.toLowerCase().includes(q))
        );
    }, [linkTypes, searchQuery]);

    if (loading) {
        return (
            <div className="space-y-3">
                <SiteCardSkeleton />
                <SiteCardSkeleton />
                <SiteCardSkeleton />
            </div>
        );
    }

    if (error) {
        return (
            <ErrorMessage
                title="Failed to load link types"
                message="Unable to fetch link type data."
                onRetry={() => refresh()}
            />
        );
    }

    return (
        <>
            {/* Search */}
            <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search link types..."
                    aria-label="Search link types"
                    className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-border bg-background text-foreground text-base focus:outline-none focus:ring-2 focus:ring-primary"
                />
            </div>

            {/* Count */}
            <p className="text-sm text-muted-foreground mb-4">
                {filteredTypes.length} link type{filteredTypes.length !== 1 ? "s" : ""}
                {searchQuery ? " (filtered)" : ""}
            </p>

            {/* List or Empty State */}
            {filteredTypes.length === 0 ? (
                <Card variant="bordered">
                    <CardContent className="text-center py-12">
                        <Link2 className="h-12 w-12 text-muted-foreground mx-auto mb-4" aria-hidden="true" />
                        <h3 className="text-lg font-semibold text-foreground mb-2">
                            {linkTypes.length === 0 ? "No link types yet" : "No link types match your search"}
                        </h3>
                        <p className="text-muted-foreground mb-4">
                            {linkTypes.length === 0
                                ? "Link types define the relationships between objects in the system."
                                : "Try adjusting your search criteria."}
                        </p>
                        {linkTypes.length === 0 && canManage && (
                            <Button
                                variant="primary"
                                onClick={() => onShowCreateChange(true)}
                                className="w-full sm:w-auto"
                            >
                                <Plus className="h-4 w-4 mr-1.5" aria-hidden="true" />
                                Create First Link Type
                            </Button>
                        )}
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-2">
                    {filteredTypes.map((lt) => (
                        <LinkTypeRow key={lt.id} linkType={lt} />
                    ))}
                </div>
            )}

            {/* Create Modal */}
            {showCreate && (
                <LinkTypeModal
                    open={showCreate}
                    onClose={() => onShowCreateChange(false)}
                    onSuccess={() => { onShowCreateChange(false); refresh(); }}
                />
            )}
        </>
    );
}

// --- Row Sub-component ---

function LinkTypeRow({ linkType }: { linkType: ApiLinkType }) {
    return (
        <Card variant="bordered" padding="sm">
            <CardContent>
                <div className="flex items-center gap-3">
                    {/* Icon */}
                    <div className="p-2 rounded-lg bg-muted shrink-0">
                        <Link2 className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                            <p className="text-sm font-medium text-foreground truncate">
                                {linkType.displayName}
                            </p>
                            {linkType.inverseName && (
                                <Badge variant="secondary" size="sm">
                                    <ArrowLeftRight className="h-3 w-3 mr-1 inline" aria-hidden="true" />
                                    {linkType.inverseName}
                                </Badge>
                            )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <code className="px-1 py-0.5 rounded bg-muted text-xs">{linkType.name}</code>
                            {linkType.description && (
                                <span className="truncate hidden sm:inline">— {linkType.description}</span>
                            )}
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
