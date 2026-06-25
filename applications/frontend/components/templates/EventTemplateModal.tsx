/**
 * Event Template Modal
 * Create/Edit event template form
 */

"use client";

import { useState } from "react";
import { Modal, ModalHeader, ModalContent, ModalFooter } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import {
    createEventTemplate,
    updateEventTemplate,
    type EventTemplate,
    type EventSeverity,
} from "@/lib/api/events";

interface EventTemplateModalProps {
    open: boolean;
    onClose: () => void;
    onSuccess: () => void;
    template?: EventTemplate;
}

const EVENT_TYPE_OPTIONS = [
    { value: "MAINTENANCE", label: "Wartung (Maintenance)" },
    { value: "FAULT", label: "Störung (Fault)" },
    { value: "COMMISSIONING", label: "Inbetriebnahme (Commissioning)" },
    { value: "SETPOINT_CHANGE", label: "Sollwertänderung (Setpoint Change)" },
];

const SEVERITY_OPTIONS = [
    { value: "DEBUG", label: "Debug" },
    { value: "INFO", label: "Info" },
    { value: "WARNING", label: "Warning" },
    { value: "ERROR", label: "Error" },
    { value: "CRITICAL", label: "Critical" },
];

export function EventTemplateModal({
    open,
    onClose,
    onSuccess,
    template,
}: EventTemplateModalProps) {
    const isEditing = !!template;

    const [label, setLabel] = useState(template?.label ?? "");
    const [eventType, setEventType] = useState(template?.eventType ?? "MAINTENANCE");
    const [severity, setSeverity] = useState<EventSeverity>(template?.severity ?? "INFO");
    const [summary, setSummary] = useState(template?.summary ?? "");
    const [sortOrder, setSortOrder] = useState(String(template?.sortOrder ?? 0));

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!label.trim() || !summary.trim()) return;

        setIsSubmitting(true);
        setError(null);

        try {
            if (isEditing && template) {
                await updateEventTemplate(template.id, {
                    label: label.trim(),
                    eventType,
                    severity,
                    summary: summary.trim(),
                    sortOrder: parseInt(sortOrder) || 0,
                });
            } else {
                await createEventTemplate({
                    label: label.trim(),
                    eventType,
                    severity,
                    summary: summary.trim(),
                    sortOrder: parseInt(sortOrder) || 0,
                });
            }
            onSuccess();
        } catch (err: any) {
            setError(err.message || "Failed to save template");
        } finally {
            setIsSubmitting(false);
        }
    }

    return (
        <Modal open={open} onClose={onClose} className="md:max-w-lg">
            <ModalHeader onClose={onClose}>
                {isEditing ? "Edit Event Template" : "New Event Template"}
            </ModalHeader>

            <form onSubmit={handleSubmit}>
                <ModalContent>
                    <div className="space-y-4">
                        {error && (
                            <div className="p-3 rounded-lg bg-danger/10 border border-danger/20 text-sm text-danger" role="alert">
                                {error}
                            </div>
                        )}

                        <Input
                            label="Label"
                            placeholder='e.g. "Jahreswartung Kessel"'
                            value={label}
                            onChange={(e) => setLabel(e.target.value)}
                            required
                            disabled={isSubmitting}
                        />

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <Select
                                label="Event Type"
                                value={eventType}
                                onChange={(e) => setEventType(e.target.value)}
                                disabled={isSubmitting}
                            >
                                {EVENT_TYPE_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                        {opt.label}
                                    </option>
                                ))}
                            </Select>

                            <Select
                                label="Severity"
                                value={severity}
                                onChange={(e) => setSeverity(e.target.value as EventSeverity)}
                                disabled={isSubmitting}
                            >
                                {SEVERITY_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                        {opt.label}
                                    </option>
                                ))}
                            </Select>
                        </div>

                        <Input
                            label="Summary"
                            placeholder="Pre-filled summary text for events created from this template"
                            value={summary}
                            onChange={(e) => setSummary(e.target.value)}
                            required
                            disabled={isSubmitting}
                        />

                        <Input
                            label="Sort Order"
                            type="number"
                            value={sortOrder}
                            onChange={(e) => setSortOrder(e.target.value)}
                            disabled={isSubmitting}
                            helperText="Lower numbers appear first"
                        />
                    </div>
                </ModalContent>

                <ModalFooter>
                    <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
                        Cancel
                    </Button>
                    <Button
                        type="submit"
                        variant="primary"
                        loading={isSubmitting}
                        disabled={!label.trim() || !summary.trim()}
                    >
                        {isSubmitting
                            ? (isEditing ? "Saving..." : "Creating...")
                            : (isEditing ? "Save Changes" : "Create Template")}
                    </Button>
                </ModalFooter>
            </form>
        </Modal>
    );
}
