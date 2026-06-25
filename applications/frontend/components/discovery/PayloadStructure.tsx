/**
 * PayloadStructure — Visualizes the analysis result:
 * Discovered fields grouped by source, inferred types, and suggested signal map.
 */

"use client";

import { Badge } from "@/components/ui/Badge";
import type { PayloadAnalysis } from "@/lib/api/types";

interface PayloadStructureProps {
    analysis: PayloadAnalysis;
}

export function PayloadStructure({ analysis }: PayloadStructureProps) {
    const { fieldsBySource, fieldTypes, suggestedSignalMap, detectedProtocol, messageCount, sourcesCount } = analysis;
    const sourceEntries = Object.entries(fieldsBySource);

    return (
        <div className="space-y-6">
            {/* Summary bar */}
            <div className="flex items-center gap-3 flex-wrap">
                <Badge variant="default" size="sm">
                    {messageCount} messages analyzed
                </Badge>
                <Badge variant="success" size="sm">
                    Protocol: {detectedProtocol}
                </Badge>
                <Badge variant="default" size="sm">
                    {sourceEntries.length} source{sourceEntries.length !== 1 ? "s" : ""}
                </Badge>
                <Badge variant="default" size="sm">
                    {suggestedSignalMap.length} numeric signal{suggestedSignalMap.length !== 1 ? "s" : ""}
                </Badge>
            </div>

            {/* Low-diversity warning */}
            {sourcesCount === 1 && (
                <p className="text-sm text-muted-foreground italic">
                    Only 1 source detected — some sensors may publish less frequently. Consider listening longer.
                </p>
            )}

            {/* Fields by source */}
            <div>
                <h4 className="text-sm font-semibold text-foreground mb-2">Discovered Fields</h4>
                {sourceEntries.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No JSON fields discovered.</p>
                ) : (
                    <div className="space-y-3">
                        {sourceEntries.map(([source, fields]) => (
                            <div key={source} className="border border-border rounded-lg p-3">
                                <h5 className="text-xs font-semibold text-primary font-mono mb-2">{source}</h5>
                                <div className="flex flex-wrap gap-2">
                                    {fields.map((field) => {
                                        const type = fieldTypes[`${source}/${field}`] || "unknown";
                                        return (
                                            <span
                                                key={field}
                                                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-muted/50 text-xs font-mono"
                                            >
                                                {field}
                                                <span className={`text-[10px] ${typeColor(type)}`}>
                                                    {type}
                                                </span>
                                            </span>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Suggested signal map */}
            {suggestedSignalMap.length > 0 && (
                <div>
                    <h4 className="text-sm font-semibold text-foreground mb-2">Suggested Signal Map</h4>
                    <div className="border border-border rounded-lg overflow-hidden">
                        <table className="w-full text-sm">
                            <thead className="bg-muted/50">
                                <tr>
                                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">#</th>
                                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Name</th>
                                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Source</th>
                                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Field</th>
                                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Unit</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {suggestedSignalMap.map((signal) => (
                                    <tr key={signal.metricId}>
                                        <td className="px-3 py-2 text-muted-foreground">{signal.metricId}</td>
                                        <td className="px-3 py-2 font-medium">{signal.name}</td>
                                        <td className="px-3 py-2 font-mono text-xs">{signal.source}</td>
                                        <td className="px-3 py-2 font-mono text-xs">{signal.field}</td>
                                        <td className="px-3 py-2 text-muted-foreground">{signal.unit || "—"}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}

function typeColor(type: string): string {
    switch (type) {
        case "number": return "text-blue-500";
        case "boolean": return "text-amber-500";
        case "string": return "text-green-500";
        case "object": return "text-purple-500";
        case "array": return "text-pink-500";
        default: return "text-muted-foreground";
    }
}
