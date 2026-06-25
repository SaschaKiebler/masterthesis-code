"use client";

import { useState } from "react";
import { Modal, ModalHeader, ModalContent, ModalFooter } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { BookmarkPlus } from "lucide-react";

interface SaveAsTemplateModalProps {
    open: boolean;
    onClose: () => void;
    widgetCount: number;
    onSave: (name: string) => Promise<void>;
}

export function SaveAsTemplateModal({ open, onClose, widgetCount, onSave }: SaveAsTemplateModalProps) {
    const [name, setName] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleSave() {
        if (!name.trim()) return;
        setSaving(true);
        setError(null);
        try {
            await onSave(name.trim());
            setName("");
            onClose();
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to save template");
        } finally {
            setSaving(false);
        }
    }

    return (
        <Modal open={open} onClose={onClose}>
            <ModalHeader onClose={onClose}>Save as Template</ModalHeader>
            <ModalContent>
                <div className="space-y-4">
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20">
                        <BookmarkPlus className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                        <div>
                            <p className="text-sm text-foreground">
                                Save this dashboard layout as a reusable template.
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                                {widgetCount} widget{widgetCount !== 1 ? "s" : ""} will be saved.
                                When applied to another project, widgets will automatically connect to matching devices and metrics.
                            </p>
                        </div>
                    </div>

                    <Input
                        label="Template Name"
                        placeholder="e.g. Stromzähler Übersicht, Heizungsmonitoring"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) handleSave(); }}
                        autoFocus
                    />

                    {error && <p className="text-xs text-danger">{error}</p>}
                </div>
            </ModalContent>
            <ModalFooter>
                <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={handleSave}
                        disabled={!name.trim() || saving}
                        loading={saving}
                    >
                        Save Template
                    </Button>
                </div>
            </ModalFooter>
        </Modal>
    );
}
