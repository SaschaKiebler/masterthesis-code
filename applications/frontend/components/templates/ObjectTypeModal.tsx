/**
 * Object Type Modal
 * Create/Edit object type form (system_admin only)
 * Fields: name, displayName, category, description, sortOrder, property fields (visual builder)
 */

"use client";

import { useState } from "react";
import { Modal, ModalHeader, ModalContent, ModalFooter } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { PropertySchemaBuilder } from "@/components/templates/PropertySchemaBuilder";
import { createObjectType, updateObjectType } from "@/lib/api/registry";
import { ApiError } from "@/lib/api/client";
import type { ObjectType, CreateObjectTypeRequest, UpdateObjectTypeRequest, PropertyFieldDefinition } from "@/lib/api/types";

interface ObjectTypeModalProps {
    open: boolean;
    onClose: () => void;
    onSuccess: (createdTypeName?: string) => void;
    objectType?: ObjectType;
}

interface FormErrors {
    name?: string;
    displayName?: string;
    category?: string;
    general?: string;
}

const CATEGORIES = [
    { value: "STRUCTURE", label: "Structure" },
    { value: "SPACE", label: "Space" },
    { value: "SYSTEM", label: "System" },
    { value: "DEVICE", label: "Device" },
    { value: "SENSOR", label: "Sensor" },
    { value: "ACTUATOR", label: "Actuator" },
    { value: "METER", label: "Meter" },
    { value: "CONTROLLER", label: "Controller" },
    { value: "GATEWAY", label: "Gateway" },
    { value: "CONTACT", label: "Contact" },
] as const;

/** Parse stored propertySchema JSON into field definitions array. */
function parseSchemaFields(json?: string): PropertyFieldDefinition[] {
    if (!json || json === "{}" || json.trim() === "") return [];
    try {
        const parsed = JSON.parse(json);
        // New simplified format: { fields: [...] }
        if (Array.isArray(parsed.fields)) return parsed.fields;
        // Legacy JSON Schema format — can't auto-convert, return empty
        return [];
    } catch {
        return [];
    }
}

/** Serialize field definitions array back to JSON for storage. */
function fieldsToJson(fields: PropertyFieldDefinition[]): string | undefined {
    if (fields.length === 0) return undefined;
    return JSON.stringify({ fields });
}

export function ObjectTypeModal({
    open,
    onClose,
    onSuccess,
    objectType,
}: ObjectTypeModalProps) {
    const isEditing = !!objectType;

    const [name, setName] = useState(objectType?.name ?? "");
    const [displayName, setDisplayName] = useState(objectType?.displayName ?? "");
    const [category, setCategory] = useState(objectType?.category ?? "");
    const [description, setDescription] = useState(objectType?.description ?? "");
    const [sortOrder, setSortOrder] = useState(String(objectType?.sortOrder ?? 0));
    const [schemaFields, setSchemaFields] = useState<PropertyFieldDefinition[]>(
        () => parseSchemaFields(objectType?.propertySchema)
    );

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errors, setErrors] = useState<FormErrors>({});

    // Auto-generate machine name from display name when creating
    function handleDisplayNameChange(value: string) {
        setDisplayName(value);
        if (!isEditing) {
            setName(
                value
                    .trim()
                    .toUpperCase()
                    .replace(/[^A-Z0-9]+/g, "_")
                    .replace(/^_|_$/g, "")
            );
        }
    }

    function validate(): boolean {
        const newErrors: FormErrors = {};
        if (!name.trim()) newErrors.name = "Machine name is required";
        if (!displayName.trim()) newErrors.displayName = "Display name is required";
        if (!category) newErrors.category = "Category is required";
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!validate()) return;

        setIsSubmitting(true);
        setErrors({});

        const schemaJson = fieldsToJson(schemaFields);

        try {
            if (isEditing && objectType) {
                const body: UpdateObjectTypeRequest = {};
                if (displayName.trim() !== objectType.displayName) body.displayName = displayName.trim();
                if (category !== objectType.category) body.category = category;
                if (description.trim() !== (objectType.description ?? "")) body.description = description.trim() || undefined;
                if (schemaJson) body.propertySchema = schemaJson;
                if (parseInt(sortOrder) !== objectType.sortOrder) body.sortOrder = parseInt(sortOrder) || 0;

                await updateObjectType(objectType.id, body);
            } else {
                const body: CreateObjectTypeRequest = {
                    name: name.trim(),
                    displayName: displayName.trim(),
                    category,
                };
                if (description.trim()) body.description = description.trim();
                if (schemaJson) body.propertySchema = schemaJson;
                body.sortOrder = parseInt(sortOrder) || 0;

                await createObjectType(body);
            }

            onSuccess(isEditing ? undefined : name.trim());
        } catch (error) {
            if (error instanceof ApiError) {
                setErrors({ general: error.message || "Failed to save object type." });
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
                {isEditing ? "Edit Object Type" : "Create Object Type"}
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
                            placeholder='e.g. "Temperature Sensor", "Heat Meter"'
                            value={displayName}
                            onChange={(e) => handleDisplayNameChange(e.target.value)}
                            error={errors.displayName}
                            required
                            disabled={isSubmitting}
                        />

                        <Input
                            label="Machine Name"
                            placeholder="e.g. TEMP_SENSOR, HEAT_METER"
                            value={name}
                            onChange={(e) => setName(e.target.value.toUpperCase())}
                            error={errors.name}
                            required
                            disabled={isSubmitting || isEditing}
                            helperText={isEditing ? "Cannot be changed after creation" : "Auto-generated from display name"}
                        />

                        <div className="grid grid-cols-2 gap-3">
                            <Select
                                label="Category"
                                value={category}
                                onChange={(e) => setCategory(e.target.value)}
                                error={errors.category}
                                required
                                disabled={isSubmitting}
                            >
                                <option value="">Select category...</option>
                                {CATEGORIES.map((c) => (
                                    <option key={c.value} value={c.value}>{c.label}</option>
                                ))}
                            </Select>
                            <Input
                                label="Sort Order"
                                type="number"
                                value={sortOrder}
                                onChange={(e) => setSortOrder(e.target.value)}
                                disabled={isSubmitting}
                                helperText="Lower = first"
                            />
                        </div>

                        <div>
                            <label htmlFor="ot-description" className="block text-sm font-medium text-foreground mb-1">
                                Description
                            </label>
                            <textarea
                                id="ot-description"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="Brief description for tooltip/help text..."
                                rows={2}
                                disabled={isSubmitting}
                                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-base focus:outline-none focus:ring-2 focus:ring-primary resize-y"
                            />
                        </div>

                        {/* Visual property field builder (ADR-014) */}
                        <PropertySchemaBuilder
                            value={schemaFields}
                            onChange={setSchemaFields}
                            disabled={isSubmitting}
                        />
                    </div>
                </ModalContent>

                <ModalFooter>
                    <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
                        Cancel
                    </Button>
                    <Button type="submit" variant="primary" loading={isSubmitting}>
                        {isSubmitting
                            ? (isEditing ? "Saving..." : "Creating...")
                            : (isEditing ? "Save Changes" : "Create Type")}
                    </Button>
                </ModalFooter>
            </form>
        </Modal>
    );
}
