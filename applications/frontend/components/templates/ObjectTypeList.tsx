/**
 * Object Type List
 * Table/card view of object types with create/edit/delete for system admins
 * Client component — manages CRUD state
 */

"use client";

import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { SiteCardSkeleton } from "@/components/ui/Skeleton";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { useObjectTypes } from "@/lib/hooks/useRegistry";
import { deleteObjectType } from "@/lib/api/registry";
import { ObjectTypeModal } from "@/components/templates/ObjectTypeModal";
import type { ObjectType } from "@/lib/api/types";
import {
    Search,
    Boxes,
    Pencil,
    Trash2,
    Plus,
} from "lucide-react";

interface ObjectTypeListProps {
    showCreate: boolean;
    onShowCreateChange: (show: boolean) => void;
    canManage: boolean;
}

const categoryColors: Record<string, "primary" | "success" | "warning" | "danger" | "default" | "secondary"> = {
    SENSOR: "primary",
    ACTUATOR: "warning",
    METER: "success",
    CONTROLLER: "danger",
    GATEWAY: "secondary",
};

export function ObjectTypeList({ showCreate, onShowCreateChange, canManage }: ObjectTypeListProps) {
    const { objectTypes, isLoading, isError, mutate } = useObjectTypes();

    const [searchQuery, setSearchQuery] = useState("");
    const [editingType, setEditingType] = useState<ObjectType | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [deleteError, setDeleteError] = useState<string | null>(null);

    // Filter
    const filteredTypes = useMemo(() => {
        if (!searchQuery.trim()) return objectTypes;
        const q = searchQuery.toLowerCase();
        return objectTypes.filter(
            (ot) =>
                ot.name.toLowerCase().includes(q) ||
                ot.displayName.toLowerCase().includes(q) ||
                ot.category.toLowerCase().includes(q) ||
                (ot.description && ot.description.toLowerCase().includes(q))
        );
    }, [objectTypes, searchQuery]);

    const handleDelete = async (id: string) => {
        setDeletingId(id);
        setDeleteError(null);
        try {
            await deleteObjectType(id);
            mutate();
        } catch (err: any) {
            setDeleteError(err.message || "Failed to delete object type");
        } finally {
            setDeletingId(null);
        }
    };

    if (isLoading) {
        return (
            <div className="space-y-3">
                <SiteCardSkeleton />
                <SiteCardSkeleton />
                <SiteCardSkeleton />
            </div>
        );
    }

    if (isError) {
        return (
            <ErrorMessage
                title="Failed to load object types"
                message="Unable to fetch object type data."
                onRetry={() => mutate()}
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
                    placeholder="Search object types..."
                    aria-label="Search object types"
                    className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-border bg-background text-foreground text-base focus:outline-none focus:ring-2 focus:ring-primary"
                />
            </div>

            {/* Count */}
            <p className="text-sm text-muted-foreground mb-4">
                {filteredTypes.length} type{filteredTypes.length !== 1 ? "s" : ""}
                {searchQuery ? " (filtered)" : ""}
            </p>

            {/* Delete error */}
            {deleteError && (
                <div className="mb-4 p-3 rounded-lg bg-danger/10 border border-danger/20 text-sm text-danger" role="alert">
                    {deleteError}
                </div>
            )}

            {/* List or Empty State */}
            {filteredTypes.length === 0 ? (
                <Card variant="bordered">
                    <CardContent className="text-center py-12">
                        <Boxes className="h-12 w-12 text-muted-foreground mx-auto mb-4" aria-hidden="true" />
                        <h3 className="text-lg font-semibold text-foreground mb-2">
                            {objectTypes.length === 0 ? "No object types yet" : "No types match your search"}
                        </h3>
                        <p className="text-muted-foreground mb-4">
                            {objectTypes.length === 0
                                ? "Object types define what kinds of assets exist in the system."
                                : "Try adjusting your search criteria."}
                        </p>
                        {objectTypes.length === 0 && canManage && (
                            <Button
                                variant="primary"
                                onClick={() => onShowCreateChange(true)}
                                className="w-full sm:w-auto"
                            >
                                <Plus className="h-4 w-4 mr-1.5" aria-hidden="true" />
                                Create First Type
                            </Button>
                        )}
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-2">
                    {filteredTypes.map((ot) => (
                        <ObjectTypeRow
                            key={ot.id}
                            objectType={ot}
                            canManage={canManage}
                            onEdit={() => setEditingType(ot)}
                            onDelete={() => handleDelete(ot.id)}
                            isDeleting={deletingId === ot.id}
                        />
                    ))}
                </div>
            )}

            {/* Create Modal */}
            {showCreate && (
                <ObjectTypeModal
                    open={showCreate}
                    onClose={() => onShowCreateChange(false)}
                    onSuccess={() => { onShowCreateChange(false); mutate(); }}
                />
            )}

            {/* Edit Modal */}
            {editingType && (
                <ObjectTypeModal
                    open={!!editingType}
                    onClose={() => setEditingType(null)}
                    onSuccess={() => { setEditingType(null); mutate(); }}
                    objectType={editingType}
                />
            )}
        </>
    );
}

// --- Row Sub-component ---

function ObjectTypeRow({
    objectType,
    canManage,
    onEdit,
    onDelete,
    isDeleting,
}: {
    objectType: ObjectType;
    canManage: boolean;
    onEdit: () => void;
    onDelete: () => void;
    isDeleting: boolean;
}) {
    const [showConfirmDelete, setShowConfirmDelete] = useState(false);

    return (
        <Card variant="bordered" padding="sm">
            <CardContent>
                <div className="flex items-center gap-3">
                    {/* Icon */}
                    <div className="p-2 rounded-lg bg-muted shrink-0">
                        <Boxes className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                            <p className="text-sm font-medium text-foreground truncate">
                                {objectType.displayName}
                            </p>
                            <Badge variant={categoryColors[objectType.category] || "default"} size="sm">
                                {objectType.category}
                            </Badge>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <code className="px-1 py-0.5 rounded bg-muted text-xs">{objectType.name}</code>
                            {objectType.description && (
                                <span className="truncate hidden sm:inline">— {objectType.description}</span>
                            )}
                        </div>
                    </div>

                    {/* Actions */}
                    {canManage && (
                        <div className="flex items-center gap-1 shrink-0">
                            <button
                                onClick={onEdit}
                                className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                                aria-label={`Edit ${objectType.displayName}`}
                            >
                                <Pencil className="h-4 w-4" aria-hidden="true" />
                            </button>
                            {showConfirmDelete ? (
                                <div className="flex items-center gap-1">
                                    <Button
                                        variant="danger"
                                        size="sm"
                                        onClick={() => { onDelete(); setShowConfirmDelete(false); }}
                                        loading={isDeleting}
                                        className="text-xs px-2 py-1"
                                    >
                                        Confirm
                                    </Button>
                                    <button
                                        onClick={() => setShowConfirmDelete(false)}
                                        className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors text-xs"
                                        aria-label="Cancel delete"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            ) : (
                                <button
                                    onClick={() => setShowConfirmDelete(true)}
                                    className="p-1.5 rounded text-muted-foreground hover:text-danger hover:bg-danger/10 transition-colors"
                                    aria-label={`Delete ${objectType.displayName}`}
                                >
                                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
