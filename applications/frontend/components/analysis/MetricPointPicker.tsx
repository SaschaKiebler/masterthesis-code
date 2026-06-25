"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import type { ProjectMetricPoint } from "@/lib/api/projects";
import { Search, X, ChevronDown } from "lucide-react";

interface MetricPointPickerProps {
    metricPoints: ProjectMetricPoint[];
    excludeIds?: string[];
    onSelect: (mp: ProjectMetricPoint) => void;
    onClose: () => void;
}

export function MetricPointPicker({ metricPoints, excludeIds = [], onSelect, onClose }: MetricPointPickerProps) {
    const [search, setSearch] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    const filtered = useMemo(() => {
        const excludeSet = new Set(excludeIds);
        const term = search.toLowerCase();
        return metricPoints
            .filter((mp) => !excludeSet.has(mp.id))
            .filter((mp) => {
                if (!term) return true;
                const searchable = [
                    mp.displayName,
                    mp.quantityDisplayName,
                    mp.quantityName,
                    mp.assetName,
                    mp.assetTypeName,
                    mp.unit,
                ].filter(Boolean).join(" ").toLowerCase();
                return searchable.includes(term);
            });
    }, [metricPoints, excludeIds, search]);

    const grouped = useMemo(() => {
        const groups = new Map<string, ProjectMetricPoint[]>();
        for (const mp of filtered) {
            const key = mp.assetName || "Unknown";
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(mp);
        }
        return groups;
    }, [filtered]);

    return (
        <div className="absolute z-50 bottom-full left-0 mb-1 w-80 max-h-80 bg-card border border-input rounded-lg shadow-lg overflow-hidden">
            <div className="p-2 border-b border-input flex items-center gap-2">
                <Search className="w-4 h-4 text-muted-foreground shrink-0" />
                <input
                    ref={inputRef}
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search sensors..."
                    className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
                />
                <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
                    <X className="w-4 h-4" />
                </button>
            </div>
            <div className="overflow-y-auto max-h-64 p-1">
                {grouped.size === 0 && (
                    <p className="text-sm text-muted-foreground p-3 text-center">No sensors found</p>
                )}
                {Array.from(grouped.entries()).map(([assetName, mps]) => (
                    <div key={assetName}>
                        <div className="px-2 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            {assetName}
                        </div>
                        {mps.map((mp) => (
                            <button
                                key={mp.id}
                                onClick={() => onSelect(mp)}
                                className="w-full text-left px-2 py-1.5 rounded text-sm hover:bg-muted transition-colors flex items-center justify-between gap-2"
                            >
                                <span className="truncate text-foreground">
                                    {mp.quantityDisplayName || mp.displayName || `Metric ${mp.metricId}`}
                                </span>
                                <span className="text-xs text-muted-foreground shrink-0">
                                    {mp.unit}
                                </span>
                            </button>
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
}
