/**
 * MessageFeed — Scrollable table of captured MQTT messages.
 * Shows timestamp, topic, payload preview, and JSON/plain badge.
 * Click a row to expand the full payload.
 */

"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import type { CapturedMessage } from "@/lib/api/types";

interface MessageFeedProps {
    messages: CapturedMessage[];
}

export function MessageFeed({ messages }: MessageFeedProps) {
    const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

    if (messages.length === 0) {
        return (
            <div className="text-center py-8 text-muted-foreground text-sm">
                No messages captured yet. Waiting for MQTT messages...
            </div>
        );
    }

    return (
        <div className="border border-border rounded-lg overflow-hidden">
            <div className="max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                    <thead className="bg-muted/50 sticky top-0">
                        <tr>
                            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Time</th>
                            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Topic</th>
                            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Payload</th>
                            <th className="text-left px-3 py-2 font-medium text-muted-foreground w-16">Type</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {messages.map((msg, idx) => {
                            const isExpanded = expandedIdx === idx;
                            const isJson = msg.parsedPayload !== null;
                            const time = new Date(msg.timestamp).toLocaleTimeString();
                            const preview = msg.rawPayload.length > 80
                                ? msg.rawPayload.substring(0, 80) + "..."
                                : msg.rawPayload;

                            return (
                                <tr
                                    key={idx}
                                    className="hover:bg-muted/30 cursor-pointer transition-colors"
                                    onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                                >
                                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground whitespace-nowrap">
                                        {time}
                                    </td>
                                    <td className="px-3 py-2 font-mono text-xs max-w-[200px] truncate" title={msg.topic}>
                                        {msg.topic}
                                    </td>
                                    <td className="px-3 py-2">
                                        {isExpanded ? (
                                            <pre className="text-xs font-mono whitespace-pre-wrap break-all bg-muted/50 rounded p-2 max-h-48 overflow-y-auto">
                                                {isJson
                                                    ? JSON.stringify(JSON.parse(msg.rawPayload), null, 2)
                                                    : msg.rawPayload}
                                            </pre>
                                        ) : (
                                            <span className="text-xs font-mono truncate block max-w-[300px]" title={msg.rawPayload}>
                                                {preview}
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-3 py-2">
                                        <Badge variant={isJson ? "success" : "default"} size="sm">
                                            {isJson ? "JSON" : "plain"}
                                        </Badge>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
