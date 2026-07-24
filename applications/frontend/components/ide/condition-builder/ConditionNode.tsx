"use client";

import { memo, useMemo } from "react";
import useSWR from "swr";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { Line, LineChart, ReferenceLine, ResponsiveContainer, YAxis } from "recharts";
import { getMeasurements } from "@/lib/api/assets";
import type { ConditionAggregate, ConditionOperator } from "@/lib/api/anomalyRules";
import { useBuilder } from "./builder-context";
import {
    AGGREGATE_HINT,
    AGGREGATE_LABEL,
    CONDITION_NODE_SIZE,
    editorToStoredValue,
    parseNumber,
    type ConditionNodeData,
} from "./graph-model";

const fieldCls =
    "nodrag w-full min-w-0 text-xs h-7 px-2 rounded border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary";
// Fixed-width variant for the operator select — deliberately without w-full.
const opCls =
    "nodrag w-12 shrink-0 text-xs h-7 px-1 rounded border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary";
const labelCls = "text-[9px] text-muted-foreground uppercase tracking-wide block mb-0.5";

const AGGREGATES: ConditionAggregate[] = [
    "duty", "mean", "min", "max", "last", "edges_per_hour", "t_out",
];

/**
 * One condition leaf as a canvas card: which signal, which windowed
 * aggregate, and the comparison — with a live sparkline of the channel's
 * recent values and a reference line at the entered threshold.
 */
function ConditionNodeInner({ id, data, selected }: NodeProps<Node<ConditionNodeData, "condition">>) {
    const { channels, currentAssetId, updateNode } = useBuilder();
    const isWeather = data.agg === "t_out";
    const channel = useMemo(
        () => channels.find((c) => c.metricPointId === data.metricPointId),
        [channels, data.metricPointId]
    );

    // Channels grouped by asset, the asset the builder was opened from first.
    const channelGroups = useMemo(() => {
        const groups = new Map<string, { label: string; options: typeof channels }>();
        for (const c of channels) {
            const key = c.assetId ?? "unassigned";
            const group = groups.get(key) ?? { label: c.assetName ?? c.deviceId, options: [] };
            group.options.push(c);
            groups.set(key, group);
        }
        const ordered = [...groups.entries()];
        ordered.sort(([a], [b]) => {
            if (a === currentAssetId) return -1;
            if (b === currentAssetId) return 1;
            return 0;
        });
        return ordered;
    }, [channels, currentAssetId]);

    return (
        <div
            className={`rounded-lg border bg-card shadow-sm p-2.5 space-y-1.5 ${
                selected ? "border-primary" : "border-border"
            }`}
            style={{ width: CONDITION_NODE_SIZE.width }}
        >
            <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                Condition
            </p>

            <div>
                <label className={labelCls}>Check</label>
                <select
                    value={data.agg}
                    onChange={(e) => updateNode(id, { agg: e.target.value as ConditionAggregate })}
                    className={fieldCls}
                >
                    {AGGREGATES.map((agg) => (
                        <option key={agg} value={agg}>{AGGREGATE_LABEL[agg]}</option>
                    ))}
                </select>
                <p className="text-[9px] leading-tight text-muted-foreground mt-0.5">
                    {AGGREGATE_HINT[data.agg]}
                </p>
            </div>

            {!isWeather && (
                <div>
                    <label className={labelCls}>Signal</label>
                    <select
                        value={data.metricPointId}
                        onChange={(e) => updateNode(id, { metricPointId: e.target.value })}
                        className={fieldCls}
                    >
                        <option value="">Select channel…</option>
                        {channelGroups.map(([assetId, group]) => (
                            <optgroup key={assetId} label={group.label}>
                                {group.options.map((c) => (
                                    <option key={c.metricPointId} value={c.metricPointId}>
                                        {c.metricName}{c.unit ? ` (${c.unit})` : ""}
                                    </option>
                                ))}
                            </optgroup>
                        ))}
                    </select>
                </div>
            )}

            <div className="flex items-end gap-1.5 min-w-0">
                {!isWeather && (
                    <div className="w-16 shrink-0">
                        <label className={labelCls}>Window</label>
                        <div className="flex items-center gap-1">
                            <input
                                type="text"
                                inputMode="decimal"
                                value={data.windowMin}
                                onChange={(e) => updateNode(id, { windowMin: e.target.value })}
                                className={`${fieldCls} text-right`}
                            />
                            <span className="text-[9px] text-muted-foreground">min</span>
                        </div>
                    </div>
                )}
                <div className="flex-1 min-w-0">
                    <label className={labelCls}>Is</label>
                    <div className="flex items-center gap-1 min-w-0">
                        <select
                            value={data.op}
                            onChange={(e) => updateNode(id, { op: e.target.value as ConditionOperator })}
                            className={opCls}
                        >
                            <option value="GT">{">"}</option>
                            <option value="LT">{"<"}</option>
                            <option value="GTE">≥</option>
                            <option value="LTE">≤</option>
                        </select>
                        <input
                            type="text"
                            inputMode="decimal"
                            value={data.value}
                            onChange={(e) => updateNode(id, { value: e.target.value })}
                            placeholder={data.agg === "duty" ? "%" : isWeather ? "°C" : channel?.unit ?? "value"}
                            className={`${fieldCls} flex-1 min-w-0 text-right`}
                        />
                        {data.agg === "duty" && (
                            <span className="text-[9px] text-muted-foreground shrink-0">%</span>
                        )}
                    </div>
                </div>
            </div>

            {!isWeather && channel && (
                <ChannelSparkline
                    assetId={channel.assetId}
                    metricName={channel.metricName}
                    threshold={editorToStoredValue(data.agg, parseNumber(data.value))}
                />
            )}

            <Handle
                type="source"
                position={Position.Right}
                className="w-2.5! h-2.5! bg-primary! border-2! border-background!"
            />
        </div>
    );
}

/** Last 3 hours of the channel, 5-minute buckets, threshold as dashed line. */
function ChannelSparkline({
    assetId,
    metricName,
    threshold,
}: {
    assetId: string | null;
    metricName: string;
    threshold: number;
}) {
    const { data } = useSWR(
        assetId ? ["condition-preview", assetId, metricName] : null,
        async () => {
            const now = Math.floor(Date.now() / 1000);
            const res = await getMeasurements(assetId!, { from: now - 3 * 3600, to: now }, 5, [metricName]);
            return res.measurements
                .filter((m) => m.metricName === metricName)
                .sort((a, b) => a.time - b.time)
                .map((m) => ({ time: m.time, value: m.value }));
        },
        { revalidateOnFocus: false, dedupingInterval: 60_000 }
    );

    if (!assetId || !data || data.length < 2) {
        return null;
    }
    return (
        <div className="h-12 -mx-1">
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                    <YAxis hide domain={["auto", "auto"]} />
                    <Line
                        type="monotone"
                        dataKey="value"
                        stroke="#6366f1"
                        strokeWidth={1.5}
                        dot={false}
                        isAnimationActive={false}
                    />
                    {!isNaN(threshold) && (
                        <ReferenceLine y={threshold} stroke="#f59e0b" strokeDasharray="4 3" />
                    )}
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
}

export const ConditionNode = memo(ConditionNodeInner);
