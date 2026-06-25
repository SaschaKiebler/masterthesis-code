/**
 * Apply Template Modal
 * Allows applying a device template's default signal map (and type) to an existing asset.
 * Uses existing PATCH endpoints — no new backend changes needed.
 */

"use client";

import { useState, useMemo, useCallback } from "react";
import { Modal, ModalHeader, ModalContent, ModalFooter } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { useDeviceTemplates } from "@/lib/hooks/useRegistry";
import { updateAsset } from "@/lib/api/assets";
import { updateDeviceConfig, updateObjectProperties } from "@/lib/api/graph";
import { parseSignalMap } from "@/lib/utils/signal-map";
import { ApiError } from "@/lib/api/client";
import type { DeviceTemplate } from "@/lib/api/types";
import { FileStack, Search, Zap, CheckCircle2 } from "lucide-react";

interface ApplyTemplateModalProps {
    open: boolean;
    onClose: () => void;
    assetId: string;
    assetName: string;
    onSuccess: () => void;
}

export function ApplyTemplateModal({ open, onClose, assetId, assetName, onSuccess }: ApplyTemplateModalProps) {
    const { templates, isLoading } = useDeviceTemplates();

    const [searchQuery, setSearchQuery] = useState("");
    const [selectedTemplate, setSelectedTemplate] = useState<DeviceTemplate | null>(null);
    const [applyType, setApplyType] = useState(true);
    const [isApplying, setIsApplying] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const filteredTemplates = useMemo(() => {
        if (!searchQuery.trim()) return templates;
        const q = searchQuery.toLowerCase();
        return templates.filter(
            (t) =>
                t.name.toLowerCase().includes(q) ||
                (t.manufacturer && t.manufacturer.toLowerCase().includes(q)) ||
                (t.modelNumber && t.modelNumber.toLowerCase().includes(q)) ||
                (t.objectType?.displayName && t.objectType.displayName.toLowerCase().includes(q))
        );
    }, [templates, searchQuery]);

    const signalPreview = useMemo(() => {
        if (!selectedTemplate?.defaultSignalMap) return [];
        return parseSignalMap(selectedTemplate.defaultSignalMap);
    }, [selectedTemplate]);

    const handleClose = useCallback(() => {
        setSelectedTemplate(null);
        setSearchQuery("");
        setError(null);
        setApplyType(true);
        onClose();
    }, [onClose]);

    async function handleApply() {
        if (!selectedTemplate) return;

        setIsApplying(true);
        setError(null);

        try {
            // Apply signal map if template has one — creates MetricPoint objects via PATCH /objects/{id}/device
            if (selectedTemplate.defaultSignalMap && selectedTemplate.defaultSignalMap !== "{}") {
                const parsed = JSON.parse(selectedTemplate.defaultSignalMap);
                await updateDeviceConfig(assetId, { signalMap: parsed });
            }

            // Optionally apply type from template's object type
            if (applyType && selectedTemplate.objectType?.name) {
                await updateAsset(assetId, { type: selectedTemplate.objectType.name });
            }

            // ADR-014: Auto-populate custom properties from template
            const customProps: Record<string, string> = {};
            if (selectedTemplate.manufacturer) customProps.manufacturer = selectedTemplate.manufacturer;
            if (selectedTemplate.modelNumber) customProps.model_number = selectedTemplate.modelNumber;
            if (selectedTemplate.protocol) customProps.protocol = selectedTemplate.protocol;
            if (selectedTemplate.defaultSpecs) {
                try { Object.assign(customProps, JSON.parse(selectedTemplate.defaultSpecs)); } catch { /* ignore */ }
            }
            if (Object.keys(customProps).length > 0) {
                try { await updateObjectProperties(assetId, customProps); } catch { /* best-effort */ }
            }

            handleClose();
            onSuccess();
        } catch (err) {
            if (err instanceof ApiError) {
                setError(err.message || "Failed to apply template.");
            } else {
                setError("Network error. Please try again.");
            }
        } finally {
            setIsApplying(false);
        }
    }

    return (
        <Modal open={open} onClose={handleClose} className="md:max-w-xl">
            <ModalHeader onClose={handleClose}>
                Apply Device Template
            </ModalHeader>

            <ModalContent>
                <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                        Select a template to apply its signal map configuration to <span className="font-medium text-foreground">{assetName}</span>.
                    </p>

                    {error && (
                        <div className="p-3 rounded-lg bg-danger/10 border border-danger/20 text-sm text-danger" role="alert">
                            {error}
                        </div>
                    )}

                    {/* Search */}
                    <div className="relative">
                        <Search className="absolute left-3 top-[2.1rem] -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        <Input
                            label="Search"
                            placeholder="Search templates..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-9"
                        />
                    </div>

                    {/* Template list */}
                    <div className="max-h-64 overflow-y-auto space-y-2">
                        {isLoading ? (
                            <p className="text-sm text-muted-foreground text-center py-4">Loading templates...</p>
                        ) : filteredTemplates.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-4">No templates found.</p>
                        ) : (
                            filteredTemplates.map((t) => (
                                <TemplateOption
                                    key={t.id}
                                    template={t}
                                    isSelected={selectedTemplate?.id === t.id}
                                    onSelect={() => setSelectedTemplate(t)}
                                />
                            ))
                        )}
                    </div>

                    {/* Preview of selected template */}
                    {selectedTemplate && (
                        <div className="p-3 rounded-lg border border-primary/30 bg-primary/5 space-y-3">
                            <div className="flex items-center gap-2">
                                <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" />
                                <span className="text-sm font-medium text-foreground">
                                    {selectedTemplate.name}
                                </span>
                            </div>

                            {/* What will be applied */}
                            <div className="space-y-2">
                                {signalPreview.length > 0 && (
                                    <div>
                                        <p className="text-xs font-medium text-muted-foreground mb-1">
                                            Signal Map ({signalPreview.length} channels)
                                        </p>
                                        <div className="flex flex-wrap gap-1">
                                            {signalPreview.slice(0, 8).map((s) => (
                                                <Badge key={s.metricId} variant="secondary" size="sm">
                                                    {s.name || `Ch ${s.metricId}`}
                                                </Badge>
                                            ))}
                                            {signalPreview.length > 8 && (
                                                <Badge variant="default" size="sm">
                                                    +{signalPreview.length - 8} more
                                                </Badge>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {selectedTemplate.objectType && (
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={applyType}
                                            onChange={(e) => setApplyType(e.target.checked)}
                                            className="rounded border-border text-primary focus:ring-primary/50"
                                        />
                                        <span className="text-xs text-muted-foreground">
                                            Also set type to <span className="font-medium text-foreground">{selectedTemplate.objectType.displayName}</span>
                                        </span>
                                    </label>
                                )}

                                {!selectedTemplate.defaultSignalMap || selectedTemplate.defaultSignalMap === "{}" ? (
                                    <p className="text-xs text-warning">
                                        This template has no default signal map configured.
                                    </p>
                                ) : null}
                            </div>
                        </div>
                    )}
                </div>
            </ModalContent>

            <ModalFooter>
                <Button type="button" variant="ghost" onClick={handleClose} disabled={isApplying}>
                    Cancel
                </Button>
                <Button
                    type="button"
                    variant="primary"
                    onClick={handleApply}
                    disabled={!selectedTemplate || isApplying}
                    loading={isApplying}
                >
                    <Zap className="h-4 w-4 mr-1" aria-hidden="true" />
                    {isApplying ? "Applying..." : "Apply Template"}
                </Button>
            </ModalFooter>
        </Modal>
    );
}

function TemplateOption({
    template,
    isSelected,
    onSelect,
}: {
    template: DeviceTemplate;
    isSelected: boolean;
    onSelect: () => void;
}) {
    const signalCount = template.defaultSignalMap
        ? Object.keys(JSON.parse(template.defaultSignalMap || "{}")).length
        : 0;

    return (
        <button
            type="button"
            onClick={onSelect}
            className={`w-full text-left p-3 rounded-lg border transition-colors ${
                isSelected
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/30 hover:bg-muted/30"
            }`}
        >
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <FileStack className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
                        <span className="text-sm font-medium text-foreground truncate">
                            {template.name}
                        </span>
                    </div>
                    {template.manufacturer && (
                        <p className="text-xs text-muted-foreground mt-0.5 ml-6">
                            {template.manufacturer}
                            {template.modelNumber ? ` · ${template.modelNumber}` : ""}
                        </p>
                    )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                    {template.objectType && (
                        <Badge variant="secondary" size="sm">
                            {template.objectType.category}
                        </Badge>
                    )}
                    {signalCount > 0 && (
                        <Badge variant="default" size="sm">
                            {signalCount} ch
                        </Badge>
                    )}
                </div>
            </div>
        </button>
    );
}
