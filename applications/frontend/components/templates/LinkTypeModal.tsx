/**
 * Link Type Modal
 * Create link type form (system_admin only)
 * Fields: name, displayName, description, inverseName
 */

"use client";

import { useState } from "react";
import { Modal, ModalHeader, ModalContent, ModalFooter } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { createLinkType } from "@/lib/api/graph";
import { ApiError } from "@/lib/api/client";
import type { CreateLinkTypeRequest } from "@/lib/api/types";
import { Info } from "lucide-react";

interface LinkTypeModalProps {
    open: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

interface FormErrors {
    name?: string;
    displayName?: string;
    general?: string;
}

export function LinkTypeModal({ open, onClose, onSuccess }: LinkTypeModalProps) {
    const [name, setName] = useState("");
    const [displayName, setDisplayName] = useState("");
    const [description, setDescription] = useState("");
    const [inverseName, setInverseName] = useState("");

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errors, setErrors] = useState<FormErrors>({});

    // Auto-generate machine name from display name
    function handleDisplayNameChange(value: string) {
        setDisplayName(value);
        setName(
            value
                .trim()
                .toUpperCase()
                .replace(/[^A-Z0-9]+/g, "_")
                .replace(/^_|_$/g, "")
        );
    }

    function validate(): boolean {
        const newErrors: FormErrors = {};

        if (!name.trim()) newErrors.name = "Machine name is required";
        if (!displayName.trim()) newErrors.displayName = "Display name is required";

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!validate()) return;

        setIsSubmitting(true);
        setErrors({});

        try {
            const body: CreateLinkTypeRequest = {
                name: name.trim(),
                displayName: displayName.trim(),
            };
            if (description.trim()) body.description = description.trim();
            if (inverseName.trim()) body.inverseName = inverseName.trim();

            await createLinkType(body);
            onSuccess();
        } catch (error) {
            if (error instanceof ApiError) {
                setErrors({ general: error.message || "Failed to create link type." });
            } else {
                setErrors({ general: "Network error. Please try again." });
            }
        } finally {
            setIsSubmitting(false);
        }
    }

    return (
        <Modal open={open} onClose={onClose} className="md:max-w-lg">
            <ModalHeader onClose={onClose}>
                Create Link Type
            </ModalHeader>

            <form onSubmit={handleSubmit}>
                <ModalContent>
                    <div className="space-y-4">
                        {errors.general && (
                            <div className="p-3 rounded-lg bg-danger/10 border border-danger/20 text-sm text-danger" role="alert">
                                {errors.general}
                            </div>
                        )}

                        <Input
                            label="Display Name"
                            placeholder='e.g. "Controls", "Monitors", "Feeds"'
                            value={displayName}
                            onChange={(e) => handleDisplayNameChange(e.target.value)}
                            error={errors.displayName}
                            required
                            disabled={isSubmitting}
                        />

                        <Input
                            label="Machine Name"
                            placeholder="e.g. CONTROLS, MONITORS, FEEDS"
                            value={name}
                            onChange={(e) => setName(e.target.value.toUpperCase())}
                            error={errors.name}
                            required
                            disabled={isSubmitting}
                            helperText="Auto-generated from display name. Normalized to UPPERCASE."
                        />

                        <div>
                            <label htmlFor="lt-description" className="block text-sm font-medium text-foreground mb-1">
                                Description
                            </label>
                            <textarea
                                id="lt-description"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="Brief description of what this relationship means..."
                                rows={2}
                                disabled={isSubmitting}
                                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-base focus:outline-none focus:ring-2 focus:ring-primary resize-y"
                            />
                        </div>

                        <div>
                            <Input
                                label="Inverse Name"
                                placeholder='e.g. "Controlled By", "Monitored By", "Fed By"'
                                value={inverseName}
                                onChange={(e) => setInverseName(e.target.value)}
                                disabled={isSubmitting}
                            />
                            <p className="text-xs text-muted-foreground flex items-start gap-1 mt-1">
                                <Info className="h-3 w-3 mt-0.5 shrink-0" aria-hidden="true" />
                                The reverse label shown on inbound links. E.g. if forward is &quot;Controls&quot;, inverse is &quot;Controlled By&quot;.
                            </p>
                        </div>
                    </div>
                </ModalContent>

                <ModalFooter>
                    <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
                        Cancel
                    </Button>
                    <Button type="submit" variant="primary" loading={isSubmitting}>
                        {isSubmitting ? "Creating..." : "Create Link Type"}
                    </Button>
                </ModalFooter>
            </form>
        </Modal>
    );
}
