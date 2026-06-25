"use client";

import { useState } from "react";
import { CHART_COLORS } from "@/lib/api/analysis";

interface ColorSwatchPickerProps {
    color: string;
    onChange: (color: string) => void;
}

export function ColorSwatchPicker({ color, onChange }: ColorSwatchPickerProps) {
    const [open, setOpen] = useState(false);

    return (
        <span className="relative inline-flex items-center">
            <button
                onClick={() => setOpen(!open)}
                className="w-3 h-3 rounded-full border border-foreground/20 hover:scale-125 transition-transform shrink-0"
                style={{ backgroundColor: color }}
                title="Change color"
            />
            {open && (
                <>
                    {/* click-outside backdrop */}
                    <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
                    <div className="absolute z-50 bottom-full left-0 mb-2 p-2 bg-card border border-input rounded-lg shadow-lg">
                        <div className="grid grid-cols-5 gap-1.5 w-max">
                            {CHART_COLORS.map((c) => (
                                <button
                                    key={c}
                                    onClick={() => { onChange(c); setOpen(false); }}
                                    className={`w-4 h-4 rounded-full hover:scale-125 transition-transform ${
                                        c.toLowerCase() === color.toLowerCase() ? "ring-2 ring-foreground/60 ring-offset-1 ring-offset-card" : ""
                                    }`}
                                    style={{ backgroundColor: c }}
                                />
                            ))}
                        </div>
                        <label className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer">
                            <input
                                type="color"
                                value={color}
                                onChange={(e) => onChange(e.target.value)}
                                className="w-5 h-5 p-0 border-0 bg-transparent cursor-pointer"
                            />
                            Custom
                        </label>
                    </div>
                </>
            )}
        </span>
    );
}
