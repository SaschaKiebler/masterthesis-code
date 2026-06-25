/**
 * LogEventModal — Manual event creation (ADR-013 "Log Event")
 * Template selector, event type cards, object picker, time toggle, summary, severity, notes.
 */

"use client";

import { useState, useMemo, useCallback } from "react";
import { Modal, ModalHeader, ModalContent, ModalFooter } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { useEventTemplates } from "@/lib/hooks/useEventTemplates";
import { recordEvent, type EventSeverity } from "@/lib/api/events";
import type { GraphObject } from "@/lib/api/types";
import { Wrench, AlertTriangle, Radio, SlidersHorizontal } from "lucide-react";

interface LogEventModalProps {
    open: boolean;
    onClose: () => void;
    objects: GraphObject[];
    preselectedObjectId?: string;
    onEventLogged?: () => void;
}

const EVENT_TYPES = [
    { key: "MAINTENANCE", label: "Wartung", icon: Wrench, defaultSeverity: "INFO" as EventSeverity },
    { key: "FAULT", label: "Störung", icon: AlertTriangle, defaultSeverity: "ERROR" as EventSeverity },
    { key: "COMMISSIONING", label: "Inbetriebnahme", icon: Radio, defaultSeverity: "INFO" as EventSeverity },
    { key: "SETPOINT_CHANGE", label: "Sollwertänderung", icon: SlidersHorizontal, defaultSeverity: "INFO" as EventSeverity },
] as const;

const SEVERITIES: { value: EventSeverity; label: string; color: string }[] = [
    { value: "DEBUG", label: "Debug", color: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" },
    { value: "INFO", label: "Info", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400" },
    { value: "WARNING", label: "Warning", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400" },
    { value: "ERROR", label: "Error", color: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400" },
    { value: "CRITICAL", label: "Critical", color: "bg-red-200 text-red-800 dark:bg-red-900/60 dark:text-red-300" },
];

export function LogEventModal({
    open,
    onClose,
    objects,
    preselectedObjectId,
    onEventLogged,
}: LogEventModalProps) {
    const { templates } = useEventTemplates();

    // Form state
    const [objectId, setObjectId] = useState(preselectedObjectId ?? "");
    const [eventType, setEventType] = useState("MAINTENANCE");
    const [severity, setSeverity] = useState<EventSeverity>("INFO");
    const [summary, setSummary] = useState("");
    const [notes, setNotes] = useState("");
    const [timeMode, setTimeMode] = useState<"now" | "custom">("now");
    const [customTime, setCustomTime] = useState("");
    const [templateId, setTemplateId] = useState("");

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Group objects by category for the picker
    const objectsByCategory = useMemo(() => {
        const groups: Record<string, GraphObject[]> = {};
        for (const obj of objects) {
            const cat = obj.objectTypeCategory || "Other";
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push(obj);
        }
        // Sort objects within each group alphabetically
        for (const cat of Object.keys(groups)) {
            groups[cat].sort((a, b) => a.displayName.localeCompare(b.displayName));
        }
        return groups;
    }, [objects]);

    const handleTemplateSelect = useCallback((id: string) => {
        setTemplateId(id);
        if (!id) return;
        const tpl = templates.find((t) => t.id === id);
        if (tpl) {
            setEventType(tpl.eventType);
            setSeverity(tpl.severity);
            setSummary(tpl.summary);
        }
    }, [templates]);

    const handleEventTypeSelect = useCallback((type: string) => {
        setEventType(type);
        const config = EVENT_TYPES.find((t) => t.key === type);
        if (config) setSeverity(config.defaultSeverity);
        setTemplateId("");
    }, []);

    const resetForm = useCallback(() => {
        setEventType("MAINTENANCE");
        setSeverity("INFO");
        setSummary("");
        setNotes("");
        setTemplateId("");
        setError(null);
        // Keep objectId and timeMode for "Log & Add Another"
    }, []);

    const handleSubmit = useCallback(async (keepOpen: boolean) => {
        if (!objectId || !summary.trim()) return;

        setIsSubmitting(true);
        setError(null);

        try {
            const details: Record<string, unknown> = {};
            if (notes.trim()) details.notes = notes.trim();

            let time: string | undefined;
            if (timeMode === "custom" && customTime) {
                time = new Date(customTime).toISOString();
            }

            await recordEvent(objectId, {
                eventType,
                severity,
                summary: summary.trim(),
                details: Object.keys(details).length > 0 ? details : undefined,
                time,
            });

            onEventLogged?.();

            if (keepOpen) {
                resetForm();
            } else {
                onClose();
            }
        } catch (err: any) {
            setError(err.message || "Failed to record event");
        } finally {
            setIsSubmitting(false);
        }
    }, [objectId, summary, notes, timeMode, customTime, eventType, severity, onEventLogged, resetForm, onClose]);

    const canSubmit = objectId && summary.trim();

    return (
        <Modal open={open} onClose={onClose} className="md:max-w-xl">
            <ModalHeader onClose={onClose}>Ereignis erfassen</ModalHeader>

            <ModalContent>
                <div className="space-y-5">
                    {error && (
                        <div className="p-3 rounded-lg bg-danger/10 border border-danger/20 text-sm text-danger" role="alert">
                            {error}
                        </div>
                    )}

                    {/* Template Selector */}
                    {templates.length > 0 && (
                        <div>
                            <label className="block text-sm font-medium text-foreground mb-1.5">
                                Vorlage (optional)
                            </label>
                            <select
                                value={templateId}
                                onChange={(e) => handleTemplateSelect(e.target.value)}
                                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                            >
                                <option value="">Keine Vorlage</option>
                                {templates.map((tpl) => (
                                    <option key={tpl.id} value={tpl.id}>
                                        {tpl.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* Event Type Cards */}
                    <div>
                        <label className="block text-sm font-medium text-foreground mb-1.5">
                            Ereignistyp
                        </label>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            {EVENT_TYPES.map((type) => {
                                const Icon = type.icon;
                                const isActive = eventType === type.key;
                                return (
                                    <button
                                        key={type.key}
                                        type="button"
                                        onClick={() => handleEventTypeSelect(type.key)}
                                        className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 transition-all text-sm ${
                                            isActive
                                                ? "border-primary bg-primary/5 text-primary"
                                                : "border-border bg-background text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground"
                                        }`}
                                    >
                                        <Icon className="h-5 w-5" />
                                        <span className="font-medium text-xs">{type.label}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Object Picker */}
                    <div>
                        <label className="block text-sm font-medium text-foreground mb-1.5">
                            Objekt <span className="text-danger">*</span>
                        </label>
                        <select
                            value={objectId}
                            onChange={(e) => setObjectId(e.target.value)}
                            required
                            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        >
                            <option value="">Objekt wählen...</option>
                            {Object.entries(objectsByCategory).map(([category, objs]) => (
                                <optgroup key={category} label={category}>
                                    {objs.map((obj) => (
                                        <option key={obj.id} value={obj.id}>
                                            {obj.displayName} ({obj.objectTypeDisplayName})
                                        </option>
                                    ))}
                                </optgroup>
                            ))}
                        </select>
                    </div>

                    {/* Time Toggle */}
                    <div>
                        <label className="block text-sm font-medium text-foreground mb-1.5">
                            Zeitpunkt
                        </label>
                        <div className="flex items-center gap-2 mb-2">
                            <button
                                type="button"
                                onClick={() => setTimeMode("now")}
                                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                                    timeMode === "now"
                                        ? "bg-primary text-primary-foreground"
                                        : "bg-muted text-muted-foreground hover:text-foreground"
                                }`}
                            >
                                Jetzt
                            </button>
                            <button
                                type="button"
                                onClick={() => setTimeMode("custom")}
                                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                                    timeMode === "custom"
                                        ? "bg-primary text-primary-foreground"
                                        : "bg-muted text-muted-foreground hover:text-foreground"
                                }`}
                            >
                                Benutzerdefiniert
                            </button>
                        </div>
                        {timeMode === "custom" && (
                            <input
                                type="datetime-local"
                                value={customTime}
                                onChange={(e) => setCustomTime(e.target.value)}
                                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                        )}
                    </div>

                    {/* Summary */}
                    <Input
                        label="Zusammenfassung"
                        placeholder="Was ist passiert?"
                        value={summary}
                        onChange={(e) => setSummary(e.target.value)}
                        required
                        disabled={isSubmitting}
                    />

                    {/* Severity Pills */}
                    <div>
                        <label className="block text-sm font-medium text-foreground mb-1.5">
                            Schweregrad
                        </label>
                        <div className="flex flex-wrap gap-1.5">
                            {SEVERITIES.map((sev) => (
                                <button
                                    key={sev.value}
                                    type="button"
                                    onClick={() => setSeverity(sev.value)}
                                    className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                                        severity === sev.value
                                            ? `${sev.color} ring-2 ring-current/20`
                                            : "bg-muted/50 text-muted-foreground opacity-60 hover:opacity-100"
                                    }`}
                                >
                                    {sev.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Notes */}
                    <div>
                        <label htmlFor="log-event-notes" className="block text-sm font-medium text-foreground mb-1.5">
                            Notizen (optional)
                        </label>
                        <textarea
                            id="log-event-notes"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Zusätzliche Details..."
                            rows={3}
                            disabled={isSubmitting}
                            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-y"
                        />
                    </div>
                </div>
            </ModalContent>

            <ModalFooter>
                <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
                    Abbrechen
                </Button>
                <Button
                    type="button"
                    variant="secondary"
                    onClick={() => handleSubmit(true)}
                    loading={isSubmitting}
                    disabled={!canSubmit}
                >
                    Erfassen &amp; Weiteres
                </Button>
                <Button
                    type="button"
                    variant="primary"
                    onClick={() => handleSubmit(false)}
                    loading={isSubmitting}
                    disabled={!canSubmit}
                >
                    Ereignis erfassen
                </Button>
            </ModalFooter>
        </Modal>
    );
}
