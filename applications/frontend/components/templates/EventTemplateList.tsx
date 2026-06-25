/**
 * Event Template List
 * Filterable card grid of event templates with create/edit/delete operations.
 * System defaults (tenantId=null) shown with badge, no edit/delete.
 */

"use client";

import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { SiteCardSkeleton } from "@/components/ui/Skeleton";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { useEventTemplates } from "@/lib/hooks/useEventTemplates";
import { deleteEventTemplate, type EventTemplate } from "@/lib/api/events";
import { EventTemplateModal } from "@/components/templates/EventTemplateModal";
import {
    Search,
    ClipboardList,
    Pencil,
    Trash2,
    Plus,
    Shield,
} from "lucide-react";

interface EventTemplateListProps {
    showCreate: boolean;
    onShowCreateChange: (show: boolean) => void;
    canCreate: boolean;
}

const EVENT_TYPE_LABELS: Record<string, string> = {
    MAINTENANCE: "Wartung",
    FAULT: "Störung",
    COMMISSIONING: "Inbetriebnahme",
    SETPOINT_CHANGE: "Sollwertänderung",
};

const EVENT_TYPE_BADGE: Record<string, "primary" | "danger" | "success" | "warning"> = {
    MAINTENANCE: "primary",
    FAULT: "danger",
    COMMISSIONING: "success",
    SETPOINT_CHANGE: "warning",
};

const SEVERITY_BADGE: Record<string, "default" | "primary" | "warning" | "danger"> = {
    DEBUG: "default",
    INFO: "primary",
    WARNING: "warning",
    ERROR: "danger",
    CRITICAL: "danger",
};

export function EventTemplateList({ showCreate, onShowCreateChange, canCreate }: EventTemplateListProps) {
    const { templates, isLoading, isError, mutate } = useEventTemplates();

    const [searchQuery, setSearchQuery] = useState("");
    const [editingTemplate, setEditingTemplate] = useState<EventTemplate | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [deleteError, setDeleteError] = useState<string | null>(null);

    const filteredTemplates = useMemo(() => {
        if (!searchQuery.trim()) return templates;
        const q = searchQuery.toLowerCase();
        return templates.filter(
            (t) =>
                t.label.toLowerCase().includes(q) ||
                t.summary.toLowerCase().includes(q) ||
                t.eventType.toLowerCase().includes(q)
        );
    }, [templates, searchQuery]);

    const handleDelete = async (id: string) => {
        setDeletingId(id);
        setDeleteError(null);
        try {
            await deleteEventTemplate(id);
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
            </div>
        );
    }

    if (isError) {
        return (
            <ErrorMessage
                title="Failed to load event templates"
                message="Unable to fetch template data. Please check if the Core Platform is running."
                onRetry={() => mutate()}
            />
        );
    }

    return (
        <>
            {/* Search */}
            <div className="flex flex-col sm:flex-row gap-3 mb-6">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search event templates..."
                        aria-label="Search event templates"
                        className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-border bg-background text-foreground text-base focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                </div>
            </div>

            {/* Count */}
            <p className="text-sm text-muted-foreground mb-4">
                {filteredTemplates.length} template{filteredTemplates.length !== 1 ? "s" : ""}
                {searchQuery ? " (filtered)" : ""}
            </p>

            {/* Delete error */}
            {deleteError && (
                <div className="mb-4 p-3 rounded-lg bg-danger/10 border border-danger/20 text-sm text-danger" role="alert">
                    {deleteError}
                </div>
            )}

            {/* Grid or Empty State */}
            {filteredTemplates.length === 0 ? (
                <Card variant="bordered">
                    <CardContent className="text-center py-12">
                        <ClipboardList className="h-12 w-12 text-muted-foreground mx-auto mb-4" aria-hidden="true" />
                        <h3 className="text-lg font-semibold text-foreground mb-2">
                            {templates.length === 0 ? "No event templates yet" : "No templates match your search"}
                        </h3>
                        <p className="text-muted-foreground mb-4">
                            {templates.length === 0
                                ? "Create event templates to streamline manual event logging."
                                : "Try adjusting your search criteria."}
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
                        <EventTemplateCard
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
                <EventTemplateModal
                    open={showCreate}
                    onClose={() => onShowCreateChange(false)}
                    onSuccess={() => { onShowCreateChange(false); mutate(); }}
                />
            )}

            {/* Edit Modal */}
            {editingTemplate && (
                <EventTemplateModal
                    open={!!editingTemplate}
                    onClose={() => setEditingTemplate(null)}
                    onSuccess={() => { setEditingTemplate(null); mutate(); }}
                    template={editingTemplate}
                />
            )}
        </>
    );
}

// --- Card Sub-component ---

function EventTemplateCard({
    template,
    canEdit,
    onEdit,
    onDelete,
    isDeleting,
}: {
    template: EventTemplate;
    canEdit: boolean;
    onEdit: () => void;
    onDelete: () => void;
    isDeleting: boolean;
}) {
    const [showConfirmDelete, setShowConfirmDelete] = useState(false);
    const isSystemDefault = template.tenantId === null;

    return (
        <Card variant="elevated" padding="md">
            <CardContent>
                {/* Header */}
                <div className="flex items-start justify-between mb-3">
                    <div className="p-2.5 rounded-lg bg-primary/10 shrink-0">
                        <ClipboardList className="h-5 w-5 text-primary" aria-hidden="true" />
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
                                    aria-label={`Edit ${template.label}`}
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
                                        aria-label={`Delete ${template.label}`}
                                    >
                                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                </div>

                {/* Label */}
                <h3 className="text-base font-semibold text-foreground mb-2 truncate">
                    {template.label}
                </h3>

                {/* Summary */}
                <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                    {template.summary}
                </p>

                {/* Badges */}
                <div className="flex flex-wrap gap-1.5 mb-3">
                    <Badge variant={EVENT_TYPE_BADGE[template.eventType] || "default"} size="sm">
                        {EVENT_TYPE_LABELS[template.eventType] || template.eventType}
                    </Badge>
                    <Badge variant={SEVERITY_BADGE[template.severity] || "default"} size="sm">
                        {template.severity}
                    </Badge>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between pt-3 border-t border-border">
                    <span className="text-xs text-muted-foreground">
                        {EVENT_TYPE_LABELS[template.eventType] || template.eventType}
                    </span>
                    <span className="text-xs text-muted-foreground">
                        Order: {template.sortOrder}
                    </span>
                </div>
            </CardContent>
        </Card>
    );
}
