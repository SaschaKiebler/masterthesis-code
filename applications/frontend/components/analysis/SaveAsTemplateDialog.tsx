"use client";

import { useState, useCallback } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { createAnalysisTemplate } from "@/lib/api/analysis";
import type { CanvasDefinition } from "@/lib/api/analysis";

interface SaveAsTemplateDialogProps {
    canvas: CanvasDefinition;
    onClose: () => void;
    onSaved: () => void;
}

export function SaveAsTemplateDialog({ canvas, onClose, onSaved }: SaveAsTemplateDialogProps) {
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [category, setCategory] = useState("general");
    const [saving, setSaving] = useState(false);

    const handleSave = useCallback(async () => {
        if (!name.trim()) return;
        setSaving(true);

        // Abstract: replace metricPointIds with quantity-based bindings
        const abstracted: CanvasDefinition = JSON.parse(JSON.stringify(canvas));
        for (const chart of abstracted.charts) {
            for (const src of chart.sources) {
                if (src.metricPointId) {
                    src.binding = {
                        quantityName: src.label.toLowerCase().replace(/\s+/g, "_"),
                        required: true,
                    };
                    delete (src as any).metricPointId;
                }
            }
        }

        try {
            await createAnalysisTemplate({
                name: name.trim(),
                description: description.trim() || undefined,
                category,
                definition: abstracted,
            });
            onSaved();
            onClose();
        } catch (e) {
            console.error("Failed to save template:", e);
        } finally {
            setSaving(false);
        }
    }, [name, description, category, canvas, onClose, onSaved]);

    return (
        <div className="absolute z-50 top-full right-0 mt-1 w-80 bg-card border border-input rounded-lg shadow-lg overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-input">
                <span className="text-sm font-medium text-foreground">Save as Template</span>
                <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
                    <X className="w-4 h-4" />
                </button>
            </div>

            <div className="p-3 space-y-3">
                <div>
                    <label className="text-xs font-medium text-muted-foreground">Name *</label>
                    <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. Heizkurvenanalyse"
                        className="mt-1 w-full text-sm bg-muted border border-input rounded px-2 py-1.5 text-foreground outline-none focus:ring-1 focus:ring-primary"
                    />
                </div>

                <div>
                    <label className="text-xs font-medium text-muted-foreground">Description</label>
                    <input
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Optional description..."
                        className="mt-1 w-full text-sm bg-muted border border-input rounded px-2 py-1.5 text-foreground outline-none focus:ring-1 focus:ring-primary"
                    />
                </div>

                <div>
                    <label className="text-xs font-medium text-muted-foreground">Category</label>
                    <select
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        className="mt-1 w-full text-sm bg-muted border border-input rounded px-2 py-1.5 text-foreground"
                    >
                        <option value="general">General</option>
                        <option value="heating">Heating</option>
                        <option value="efficiency">Efficiency</option>
                        <option value="hydraulic">Hydraulic</option>
                    </select>
                </div>
            </div>

            <div className="px-3 py-2 border-t border-input">
                <Button size="sm" onClick={handleSave} loading={saving} disabled={!name.trim()} fullWidth>
                    Save Template
                </Button>
            </div>
        </div>
    );
}
