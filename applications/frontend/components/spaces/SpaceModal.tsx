/**
 * Space Modal
 * Create or edit a space within a site's spatial hierarchy
 */

"use client";

import { useState, useEffect } from "react";
import { Modal, ModalHeader, ModalContent, ModalFooter } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { createSpace, updateSpace } from "@/lib/api/spaces";
import { ApiError } from "@/lib/api/client";
import type { SpaceDTO } from "@/lib/api/types";

const SPACE_TYPES = [
    { value: "FLOOR", label: "Floor" },
    { value: "APARTMENT", label: "Apartment" },
    { value: "ROOM", label: "Room" },
    { value: "BASEMENT", label: "Basement" },
    { value: "COMMON_AREA", label: "Common Area" },
    { value: "TECHNICAL_ROOM", label: "Technical Room" },
];

interface SpaceModalProps {
    open: boolean;
    onClose: () => void;
    onSuccess: () => void;
    siteId: string;
    parentSpaceId?: string | null;
    editSpace?: SpaceDTO | null;
}

interface FormErrors {
    name?: string;
    type?: string;
    general?: string;
}

export function SpaceModal({
    open,
    onClose,
    onSuccess,
    siteId,
    parentSpaceId,
    editSpace,
}: SpaceModalProps) {
    const isEditing = !!editSpace;

    const [name, setName] = useState("");
    const [type, setType] = useState("ROOM");
    const [sqm, setSqm] = useState("");
    const [exposure, setExposure] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errors, setErrors] = useState<FormErrors>({});

    useEffect(() => {
        if (open) {
            if (editSpace) {
                setName(editSpace.name);
                setType(editSpace.type);
                try {
                    const attrs = JSON.parse(editSpace.attributes || "{}");
                    setSqm(attrs.sqm?.toString() || "");
                    setExposure(attrs.exposure || "");
                } catch {
                    setSqm("");
                    setExposure("");
                }
            } else {
                setName("");
                setType(parentSpaceId ? "ROOM" : "FLOOR");
                setSqm("");
                setExposure("");
            }
            setErrors({});
        }
    }, [open, editSpace, parentSpaceId]);

    function validate(): boolean {
        const newErrors: FormErrors = {};
        if (!name.trim()) {
            newErrors.name = "Name is required";
        } else if (name.trim().length < 2) {
            newErrors.name = "Name must be at least 2 characters";
        }
        if (!type) {
            newErrors.type = "Type is required";
        }
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!validate()) return;

        setIsSubmitting(true);
        setErrors({});

        const attributes: Record<string, any> = {};
        if (sqm.trim()) attributes.sqm = parseFloat(sqm);
        if (exposure.trim()) attributes.exposure = exposure.trim();

        try {
            if (isEditing && editSpace) {
                await updateSpace(siteId, editSpace.id, {
                    name: name.trim(),
                    type,
                    attributes: JSON.stringify(attributes),
                });
            } else {
                await createSpace(siteId, {
                    name: name.trim(),
                    type,
                    parentSpaceId: parentSpaceId || undefined,
                    attributes: JSON.stringify(attributes),
                });
            }
            onClose();
            onSuccess();
        } catch (error) {
            if (error instanceof ApiError) {
                setErrors({ general: error.message || "Failed to save space." });
            } else {
                setErrors({ general: "Network error. Please try again." });
            }
        } finally {
            setIsSubmitting(false);
        }
    }

    return (
        <Modal open={open} onClose={onClose}>
            <ModalHeader onClose={onClose}>
                {isEditing ? "Edit Space" : "Add Space"}
            </ModalHeader>

            <form onSubmit={handleSubmit}>
                <ModalContent>
                    <div className="space-y-4">
                        {errors.general && (
                            <div
                                className="p-3 rounded-lg bg-danger/10 border border-danger/20 text-sm text-danger"
                                role="alert"
                            >
                                {errors.general}
                            </div>
                        )}

                        <Select
                            label="Space Type"
                            value={type}
                            onChange={(e) => setType(e.target.value)}
                            error={errors.type}
                            required
                            disabled={isSubmitting}
                        >
                            {SPACE_TYPES.map((t) => (
                                <option key={t.value} value={t.value}>
                                    {t.label}
                                </option>
                            ))}
                        </Select>

                        <Input
                            label="Name"
                            placeholder="e.g. Ground Floor, Apt 3B, Living Room"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            error={errors.name}
                            required
                            disabled={isSubmitting}
                        />

                        <div className="grid grid-cols-2 gap-3">
                            <Input
                                label="Area (m²)"
                                placeholder="e.g. 65"
                                type="number"
                                value={sqm}
                                onChange={(e) => setSqm(e.target.value)}
                                disabled={isSubmitting}
                            />
                            <Select
                                label="Exposure"
                                value={exposure}
                                onChange={(e) => setExposure(e.target.value)}
                                disabled={isSubmitting}
                            >
                                <option value="">Not specified</option>
                                <option value="NORTH">North</option>
                                <option value="SOUTH">South</option>
                                <option value="EAST">East</option>
                                <option value="WEST">West</option>
                                <option value="NORTH_EAST">North-East</option>
                                <option value="NORTH_WEST">North-West</option>
                                <option value="SOUTH_EAST">South-East</option>
                                <option value="SOUTH_WEST">South-West</option>
                            </Select>
                        </div>
                    </div>
                </ModalContent>

                <ModalFooter>
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={onClose}
                        disabled={isSubmitting}
                        className="w-full sm:w-auto"
                    >
                        Cancel
                    </Button>
                    <Button
                        type="submit"
                        variant="primary"
                        loading={isSubmitting}
                        className="w-full sm:w-auto"
                    >
                        {isSubmitting ? "Saving..." : isEditing ? "Save Changes" : "Add Space"}
                    </Button>
                </ModalFooter>
            </form>
        </Modal>
    );
}
