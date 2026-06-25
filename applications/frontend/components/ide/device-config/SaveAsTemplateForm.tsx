"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { createDeviceTemplate, listObjectTypes } from "@/lib/api/registry";
import type { SignalMapEntry } from "@/lib/api/types";
import { AlertCircle, Save } from "lucide-react";
import { PROTOCOL_OPTIONS } from "./constants";

interface SaveAsTemplateFormProps {
    signalMap: Record<string, SignalMapEntry>;
    modelHuman: string;
    objectTypeName: string;
    onSaved: (name: string) => void;
    onCancel: () => void;
}

export function SaveAsTemplateForm({
    signalMap,
    modelHuman,
    objectTypeName,
    onSaved,
    onCancel,
}: SaveAsTemplateFormProps) {
    const [name, setName] = useState(modelHuman || "");
    const [manufacturer, setManufacturer] = useState("");
    const [description, setDescription] = useState("");
    const [protocol, setProtocol] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSave = async () => {
        if (!name.trim()) {
            setError("Template name is required");
            return;
        }
        setSaving(true);
        setError(null);
        try {
            // Look up objectTypeId from name
            let objectTypeId: string | undefined;
            const otRes = await listObjectTypes();
            const match = otRes.objectTypes?.find((ot) => ot.name === objectTypeName);
            if (match) objectTypeId = match.id;

            await createDeviceTemplate({
                name: name.trim(),
                manufacturer: manufacturer.trim() || undefined,
                description: description.trim() || undefined,
                protocol: protocol.trim().toUpperCase() || undefined,
                objectTypeId,
                defaultSignalMap: JSON.stringify(signalMap),
            });
            onSaved(name.trim());
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to create template");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="mt-1.5 p-2 border border-border rounded bg-background/50 space-y-1.5">
            {error && (
                <div className="flex items-center gap-1.5 text-xs text-danger p-1.5 bg-danger/5 rounded">
                    <AlertCircle className="h-3 w-3 shrink-0" />
                    {error}
                </div>
            )}
            <div>
                <label className="text-[10px] text-muted-foreground">Name *</label>
                <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Template name"
                    className="w-full h-6 px-1.5 text-xs bg-background border border-border rounded text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary"
                />
            </div>
            <div className="flex gap-1.5">
                <div className="flex-1">
                    <label className="text-[10px] text-muted-foreground">Manufacturer</label>
                    <input
                        value={manufacturer}
                        onChange={(e) => setManufacturer(e.target.value)}
                        placeholder="e.g. Shelly"
                        className="w-full h-6 px-1.5 text-xs bg-background border border-border rounded text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                </div>
                <div className="flex-1">
                    <label className="text-[10px] text-muted-foreground">Protocol</label>
                    <input
                        value={protocol}
                        onChange={(e) => setProtocol(e.target.value)}
                        list="save-tpl-protocol"
                        placeholder="e.g. MQTT"
                        className="w-full h-6 px-1.5 text-xs bg-background border border-border rounded text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <datalist id="save-tpl-protocol">
                        {PROTOCOL_OPTIONS.map((p) => (
                            <option key={p} value={p} />
                        ))}
                    </datalist>
                </div>
            </div>
            <div>
                <label className="text-[10px] text-muted-foreground">Description</label>
                <input
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Optional description"
                    className="w-full h-6 px-1.5 text-xs bg-background border border-border rounded text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary"
                />
            </div>
            <div className="text-[10px] text-muted-foreground">
                Signal map ({Object.keys(signalMap).length} entries) will be included.
            </div>
            <div className="flex gap-1.5 pt-0.5">
                <Button size="sm" onClick={handleSave} loading={saving}>
                    <Save className="h-3.5 w-3.5 mr-1" /> Create Template
                </Button>
                <Button size="sm" variant="ghost" onClick={onCancel}>
                    Cancel
                </Button>
            </div>
        </div>
    );
}
