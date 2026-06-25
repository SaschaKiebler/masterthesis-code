/**
 * Device Template List
 * Filterable card grid of device templates with create/edit/delete operations
 * Client component — manages filter state, CRUD modals
 */

"use client";

import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { SiteCardSkeleton } from "@/components/ui/Skeleton";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { useObjectTypes, useDeviceTemplates } from "@/lib/hooks/useRegistry";
import { deleteDeviceTemplate } from "@/lib/api/registry";
import { DeviceTemplateModal } from "@/components/templates/DeviceTemplateModal";
import { parseSignalMap } from "@/lib/utils/signal-map";
import type { DeviceTemplate } from "@/lib/api/types";
import {
    Search,
    LayoutTemplate,
    Pencil,
    Trash2,
    Wifi,
    Tag,
    Plus,
    Shield,
} from "lucide-react";

interface DeviceTemplateListProps {
    showCreate: boolean;
    onShowCreateChange: (show: boolean) => void;
    canCreate: boolean;
}

const PROTOCOL_OPTIONS = ["All", "LORA", "WMBUS", "MODBUS", "SHELLY", "MQTT"] as const;
const CATEGORY_OPTIONS = ["All", "SENSOR", "ACTUATOR", "METER", "CONTROLLER", "GATEWAY"] as const;

const categoryColors: Record<string, "primary" | "success" | "warning" | "danger" | "default" | "secondary"> = {
    SENSOR: "primary",
    ACTUATOR: "warning",
    METER: "success",
    CONTROLLER: "danger",
    GATEWAY: "secondary",
};

export function DeviceTemplateList({ showCreate, onShowCreateChange, canCreate }: DeviceTemplateListProps) {
    const { templates, isLoading, isError, mutate } = useDeviceTemplates();
    const { objectTypes } = useObjectTypes();

    const [searchQuery, setSearchQuery] = useState("");
    const [protocolFilter, setProtocolFilter] = useState("All");
    const [categoryFilter, setCategoryFilter] = useState("All");
    const [editingTemplate, setEditingTemplate] = useState<DeviceTemplate | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [deleteError, setDeleteError] = useState<string | null>(null);

    // Filter templates
    const filteredTemplates = useMemo(() => {
        let result = templates;

        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            result = result.filter(
                (t) =>
                    t.name.toLowerCase().includes(q) ||
                    (t.manufacturer && t.manufacturer.toLowerCase().includes(q)) ||
                    (t.modelNumber && t.modelNumber.toLowerCase().includes(q)) ||
                    (t.description && t.description.toLowerCase().includes(q))
            );
        }

        if (protocolFilter !== "All") {
            result = result.filter((t) => t.protocol === protocolFilter);
        }

        if (categoryFilter !== "All") {
            result = result.filter((t) => t.objectType?.category === categoryFilter);
        }

        return result;
    }, [templates, searchQuery, protocolFilter, categoryFilter]);

    const handleDelete = async (id: string) => {
        setDeletingId(id);
        setDeleteError(null);
        try {
            await deleteDeviceTemplate(id);
            mutate();
        } catch (err: any) {
            setDeleteError(err.message || "Failed to delete template");
        } finally {
            setDeletingId(null);
        }
    };

    if (isLoading) {
        return (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                <SiteCardSkeleton />
                <SiteCardSkeleton />
                <SiteCardSkeleton />
                <SiteCardSkeleton />
                <SiteCardSkeleton />
                <SiteCardSkeleton />
            </div>
        );
    }

    if (isError) {
        return (
            <ErrorMessage
                title="Failed to load device templates"
                message="Unable to fetch template data. Please check if the Core Platform is running."
                onRetry={() => mutate()}
            />
        );
    }

    return (
        <>
            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-3 mb-6">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search templates..."
                        aria-label="Search device templates"
                        className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-border bg-background text-foreground text-base focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                </div>
                <select
                    value={protocolFilter}
                    onChange={(e) => setProtocolFilter(e.target.value)}
                    aria-label="Filter by protocol"
                    className="px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                >
                    {PROTOCOL_OPTIONS.map((p) => (
                        <option key={p} value={p}>
                            {p === "All" ? "All Protocols" : p}
                        </option>
                    ))}
                </select>
                <select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    aria-label="Filter by category"
                    className="px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                >
                    {CATEGORY_OPTIONS.map((c) => (
                        <option key={c} value={c}>
                            {c === "All" ? "All Categories" : c}
                        </option>
                    ))}
                </select>
            </div>

            {/* Count */}
            <p className="text-sm text-muted-foreground mb-4">
                {filteredTemplates.length} template{filteredTemplates.length !== 1 ? "s" : ""}
                {searchQuery || protocolFilter !== "All" || categoryFilter !== "All" ? " (filtered)" : ""}
            </p>

            {/* Delete error toast */}
            {deleteError && (
                <div className="mb-4 p-3 rounded-lg bg-danger/10 border border-danger/20 text-sm text-danger" role="alert">
                    {deleteError}
                </div>
            )}

            {/* Grid or Empty State */}
            {filteredTemplates.length === 0 ? (
                <Card variant="bordered">
                    <CardContent className="text-center py-12">
                        <LayoutTemplate className="h-12 w-12 text-muted-foreground mx-auto mb-4" aria-hidden="true" />
                        <h3 className="text-lg font-semibold text-foreground mb-2">
                            {templates.length === 0 ? "No device templates yet" : "No templates match your filters"}
                        </h3>
                        <p className="text-muted-foreground mb-4">
                            {templates.length === 0
                                ? "Create your first device template to streamline asset registration."
                                : "Try adjusting your search or filter criteria."}
                        </p>
                        {templates.length === 0 && canCreate && (
                            <Button
                                variant="primary"
                                onClick={() => onShowCreateChange(true)}
                                className="w-full sm:w-auto"
                            >
                                <Plus className="h-4 w-4 mr-1.5" aria-hidden="true" />
                                Create First Template
                            </Button>
                        )}
                    </CardContent>
                </Card>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                    {filteredTemplates.map((template) => (
                        <DeviceTemplateCard
                            key={template.id}
                            template={template}
                            canEdit={canCreate}
                            onEdit={() => setEditingTemplate(template)}
                            onDelete={() => handleDelete(template.id)}
                            isDeleting={deletingId === template.id}
                        />
                    ))}
                </div>
            )}

            {/* Create Modal */}
            {showCreate && (
                <DeviceTemplateModal
                    open={showCreate}
                    onClose={() => onShowCreateChange(false)}
                    onSuccess={() => { onShowCreateChange(false); mutate(); }}
                    objectTypes={objectTypes}
                />
            )}

            {/* Edit Modal */}
            {editingTemplate && (
                <DeviceTemplateModal
                    open={!!editingTemplate}
                    onClose={() => setEditingTemplate(null)}
                    onSuccess={() => { setEditingTemplate(null); mutate(); }}
                    objectTypes={objectTypes}
                    template={editingTemplate}
                />
            )}
        </>
    );
}

// --- Card Sub-component ---

function DeviceTemplateCard({
    template,
    canEdit,
    onEdit,
    onDelete,
    isDeleting,
}: {
    template: DeviceTemplate;
    canEdit: boolean;
    onEdit: () => void;
    onDelete: () => void;
    isDeleting: boolean;
}) {
    const [showConfirmDelete, setShowConfirmDelete] = useState(false);
    const signalCount = useMemo(
        () => parseSignalMap(template.defaultSignalMap).length,
        [template.defaultSignalMap]
    );
    const isSystemDefault = template.tenantId === null;

    return (
        <Card variant="elevated" padding="md">
            <CardContent>
                {/* Header */}
                <div className="flex items-start justify-between mb-3">
                    <div className="p-2.5 rounded-lg bg-primary/10 shrink-0">
                        <LayoutTemplate className="h-5 w-5 text-primary" aria-hidden="true" />
                    </div>
                    <div className="flex items-center gap-1">
                        {isSystemDefault && (
                            <Badge variant="default" size="sm">
                                <Shield className="h-3 w-3 mr-1" aria-hidden="true" />
                                System
                            </Badge>
                        )}
                        {canEdit && (
                            <>
                                <button
                                    onClick={onEdit}
                                    className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                                    aria-label={`Edit ${template.name}`}
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
                                        aria-label={`Delete ${template.name}`}
                                    >
                                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                </div>

                {/* Name & Manufacturer */}
                <h3 className="text-base font-semibold text-foreground mb-1 truncate">
                    {template.manufacturer && (
                        <span className="text-muted-foreground font-normal">{template.manufacturer} </span>
                    )}
                    {template.name}
                </h3>

                {/* Model Number */}
                {template.modelNumber && (
                    <p className="text-xs text-muted-foreground mb-2 truncate">{template.modelNumber}</p>
                )}

                {/* Description */}
                {template.description && (
                    <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{template.description}</p>
                )}

                {/* Badges */}
                <div className="flex flex-wrap gap-1.5 mb-3">
                    {template.protocol && (
                        <Badge variant="secondary" size="sm">
                            <Wifi className="h-3 w-3 mr-1" aria-hidden="true" />
                            {template.protocol}
                        </Badge>
                    )}
                    {template.objectType && (
                        <Badge variant={categoryColors[template.objectType.category] || "default"} size="sm">
                            <Tag className="h-3 w-3 mr-1" aria-hidden="true" />
                            {template.objectType.displayName}
                        </Badge>
                    )}
                    {signalCount > 0 && (
                        <Badge variant="success" size="sm">
                            {signalCount} signal{signalCount !== 1 ? "s" : ""}
                        </Badge>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between pt-3 border-t border-border">
                    <span className="text-xs text-muted-foreground">
                        {template.objectType?.category || "Uncategorized"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                        Order: {template.sortOrder}
                    </span>
                </div>
            </CardContent>
        </Card>
    );
}
