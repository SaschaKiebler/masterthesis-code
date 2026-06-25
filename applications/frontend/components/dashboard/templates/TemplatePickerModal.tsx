"use client";

import { useState } from "react";
import { Modal, ModalHeader, ModalContent, ModalFooter } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils/cn";
import { useDashboardTemplates } from "@/lib/hooks/useDashboardTemplates";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import {
    LayoutDashboard, Check, Trash2, Search, Loader2,
} from "lucide-react";
import type { DashboardTemplateDTO } from "@/lib/api/dashboard-templates";

interface TemplatePickerModalProps {
    open: boolean;
    onClose: () => void;
    onApply: (template: DashboardTemplateDTO) => void;
    applying?: boolean;
}

export function TemplatePickerModal({ open, onClose, onApply, applying }: TemplatePickerModalProps) {
    const { templates, isLoading, remove } = useDashboardTemplates();
    const [selected, setSelected] = useState<DashboardTemplateDTO | null>(null);
    const [search, setSearch] = useState("");
    const [deleteTarget, setDeleteTarget] = useState<DashboardTemplateDTO | null>(null);
    const [deleting, setDeleting] = useState(false);

    const filtered = search.trim()
        ? templates.filter(t => t.name.toLowerCase().includes(search.toLowerCase()))
        : templates;

    function getWidgetCount(t: DashboardTemplateDTO): number {
        try {
            const layout = JSON.parse(t.layout);
            return layout?.widgets?.length ?? 0;
        } catch { return 0; }
    }

    async function handleDelete() {
        if (!deleteTarget) return;
        setDeleting(true);
        try {
            await remove(deleteTarget.id);
            if (selected?.id === deleteTarget.id) setSelected(null);
            setDeleteTarget(null);
        } finally {
            setDeleting(false);
        }
    }

    return (
        <>
            <Modal open={open} onClose={onClose}>
                <ModalHeader onClose={onClose}>Use a Template</ModalHeader>
                <ModalContent>
                    <div className="space-y-4">
                        {isLoading ? (
                            <div className="flex items-center justify-center py-10">
                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                            </div>
                        ) : templates.length === 0 ? (
                            <div className="py-8 text-center">
                                <LayoutDashboard className="h-8 w-8 mx-auto mb-3 text-muted-foreground/40" />
                                <p className="text-sm text-foreground mb-1">No templates yet</p>
                                <p className="text-xs text-muted-foreground">
                                    Build a dashboard first, then save it as a template from the editor.
                                </p>
                            </div>
                        ) : (
                            <>
                                {templates.length > 4 && (
                                    <div className="relative">
                                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                                        <input
                                            type="text"
                                            placeholder="Search templates..."
                                            value={search}
                                            onChange={(e) => setSearch(e.target.value)}
                                            className="w-full h-8 pl-8 pr-3 text-sm bg-background border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                        />
                                    </div>
                                )}
                                <div className="max-h-[320px] overflow-y-auto space-y-1.5">
                                    {filtered.map(t => {
                                        const isSelected = selected?.id === t.id;
                                        const wCount = getWidgetCount(t);
                                        return (
                                            <div
                                                key={t.id}
                                                className={cn(
                                                    "flex items-center gap-3 w-full px-3 py-2.5 rounded-lg border transition-colors cursor-pointer group",
                                                    isSelected
                                                        ? "border-primary bg-primary/5"
                                                        : "border-border hover:border-primary/30 hover:bg-muted/30"
                                                )}
                                                onClick={() => setSelected(isSelected ? null : t)}
                                            >
                                                <div className={cn(
                                                    "p-1.5 rounded-md shrink-0",
                                                    isSelected ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                                                )}>
                                                    <LayoutDashboard className="h-4 w-4" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-medium text-foreground truncate">{t.name}</p>
                                                    <p className="text-[11px] text-muted-foreground">
                                                        {wCount} widget{wCount !== 1 ? "s" : ""}
                                                        {" · "}
                                                        {new Date(t.createdAt).toLocaleDateString("de-DE")}
                                                    </p>
                                                </div>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setDeleteTarget(t); }}
                                                    className="p-1 rounded text-muted-foreground/0 group-hover:text-muted-foreground hover:text-danger! hover:bg-danger/10 transition-all shrink-0"
                                                    title="Delete template"
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </button>
                                                {isSelected && <Check className="h-4 w-4 text-primary shrink-0" />}
                                            </div>
                                        );
                                    })}
                                    {filtered.length === 0 && search.trim() && (
                                        <p className="text-xs text-muted-foreground text-center py-4">No matching templates.</p>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                </ModalContent>
                <ModalFooter>
                    <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
                        <Button
                            variant="primary"
                            size="sm"
                            onClick={() => selected && onApply(selected)}
                            disabled={!selected || applying}
                            loading={applying}
                        >
                            Apply Template
                        </Button>
                    </div>
                </ModalFooter>
            </Modal>

            <ConfirmModal
                open={!!deleteTarget}
                onClose={() => setDeleteTarget(null)}
                onConfirm={handleDelete}
                title="Delete Template"
                message={`Are you sure you want to delete "${deleteTarget?.name}"?`}
                confirmLabel="Delete Template"
                loading={deleting}
            />
        </>
    );
}
