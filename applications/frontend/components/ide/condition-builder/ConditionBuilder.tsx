"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
    Background,
    Controls,
    ReactFlow,
    ReactFlowProvider,
    addEdge,
    useEdgesState,
    useNodesState,
    type Connection,
    type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AlertCircle, LayoutGrid, Loader2, Plus, X } from "lucide-react";
import type { RuleSeverity } from "@/lib/api/thresholdRules";
import type { AnomalyRule, AnomalyRuleInput, ChannelOption, ConditionTree } from "@/lib/api/anomalyRules";
import { BuilderContext, type BuilderContextValue } from "./builder-context";
import { ConditionNode } from "./ConditionNode";
import { GroupNode } from "./GroupNode";
import {
    conditionToGraph,
    graphToCondition,
    layoutGraph,
    makeEdge,
    nextId,
    type BuilderNode,
} from "./graph-model";

// Module-level constants: React Flow re-syncs when these props change
// identity, so they must never be recreated per render.
const nodeTypes = { condition: ConditionNode, group: GroupNode };
const FIT_VIEW_OPTIONS = { padding: 0.25, maxZoom: 1 };
const DELETE_KEY_CODES = ["Backspace", "Delete"];
const DEFAULT_EDGE_OPTIONS = { type: "smoothstep" as const, style: { strokeWidth: 1.5 } };
const PRO_OPTIONS = { hideAttribution: true };

const fieldCls =
    "text-xs h-8 px-2 rounded border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary";
const paletteBtnCls =
    "flex items-center gap-1 text-xs px-2.5 py-1.5 rounded border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted transition-colors";

const SUPPRESS_ROLE = "suppress_while";

interface ConditionBuilderProps {
    open: boolean;
    channels: ChannelOption[];
    /** Rule being edited; null when creating a new one. */
    initialRule: AnomalyRule | null;
    onSave: (input: AnomalyRuleInput) => Promise<void>;
    onClose: () => void;
}

export function ConditionBuilder(props: ConditionBuilderProps) {
    if (!props.open) return null;
    return (
        <ReactFlowProvider>
            <BuilderInner {...props} />
        </ReactFlowProvider>
    );
}

function initialGraph(rule: AnomalyRule | null): { nodes: BuilderNode[]; edges: Edge[] } {
    const condition = rule?.params?.condition as ConditionTree | undefined;
    if (rule && condition) {
        return conditionToGraph(
            condition,
            rule.bindings.filter((b) => b.role !== SUPPRESS_ROLE)
        );
    }
    const groupId = nextId("group");
    const conditionId = nextId("condition");
    const nodes: BuilderNode[] = [
        {
            id: conditionId,
            type: "condition",
            position: { x: 0, y: 0 },
            data: { agg: "duty", metricPointId: "", windowMin: "30", op: "GT", value: "0.9" },
        },
        { id: groupId, type: "group", position: { x: 0, y: 0 }, data: { mode: "all" } },
    ];
    const edges = [makeEdge(conditionId, groupId)];
    return { nodes: layoutGraph(nodes, edges), edges };
}

function BuilderInner({ channels, initialRule, onSave, onClose }: ConditionBuilderProps) {
    const initial = useMemo(() => initialGraph(initialRule), [initialRule]);
    const [nodes, setNodes, onNodesChange] = useNodesState<BuilderNode>(initial.nodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.edges);

    const [name, setName] = useState(initialRule?.name ?? "");
    const [severity, setSeverity] = useState<RuleSeverity>(initialRule?.severity ?? "WARNING");
    const [cooldown, setCooldown] = useState(String(initialRule?.cooldownSeconds ?? 1800));
    const [suppressId, setSuppressId] = useState(
        initialRule?.bindings.find((b) => b.role === SUPPRESS_ROLE)?.metricPointId ?? ""
    );
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);

    const updateNode = useCallback((id: string, patch: Record<string, unknown>) => {
        setNodes((prev) => prev.map((node) =>
            node.id === id ? ({ ...node, data: { ...node.data, ...patch } } as BuilderNode) : node
        ));
    }, [setNodes]);

    const context = useMemo<BuilderContextValue>(
        () => ({ channels, updateNode }),
        [channels, updateNode]
    );

    // A block feeds exactly one group: a new connection replaces the source's
    // previous outgoing edge.
    const onConnect = useCallback((connection: Connection) => {
        if (connection.source === connection.target) return;
        setEdges((prev) => addEdge(
            { ...connection, ...DEFAULT_EDGE_OPTIONS },
            prev.filter((e) => e.source !== connection.source)
        ));
    }, [setEdges]);

    const rootGroupId = useMemo(() => {
        const outgoing = new Set(edges.map((e) => e.source));
        const roots = nodes.filter((n) => n.type === "group" && !outgoing.has(n.id));
        return roots.length === 1 ? roots[0].id : null;
    }, [nodes, edges]);

    const addCondition = useCallback(() => {
        const id = nextId("condition");
        const y = 40 + nodes.filter((n) => n.type === "condition").length * 90;
        setNodes((prev) => [...prev, {
            id,
            type: "condition",
            position: { x: 40, y },
            data: { agg: "duty", metricPointId: "", windowMin: "30", op: "GT", value: "0.5" },
        }]);
        if (rootGroupId) {
            setEdges((prev) => [...prev, makeEdge(id, rootGroupId)]);
        }
    }, [nodes, rootGroupId, setNodes, setEdges]);

    const addGroup = useCallback((mode: "all" | "any") => {
        const id = nextId("group");
        setNodes((prev) => [...prev, {
            id,
            type: "group",
            position: { x: 380, y: 40 + prev.filter((n) => n.type === "group").length * 80 },
            data: { mode },
        }]);
    }, [setNodes]);

    const autoLayout = useCallback(() => {
        setNodes((prev) => layoutGraph(prev, edges));
    }, [edges, setNodes]);

    const serialized = useMemo(
        () => graphToCondition(nodes, edges, channels),
        [nodes, edges, channels]
    );

    const problems = useMemo(() => {
        const list = [...serialized.errors];
        if (!name.trim()) list.unshift("Give the rule a name.");
        const cooldownSec = parseInt(cooldown, 10);
        if (isNaN(cooldownSec) || cooldownSec < 0) list.push("Cooldown must be ≥ 0.");
        return list;
    }, [serialized, name, cooldown]);

    const handleSave = useCallback(async () => {
        if (problems.length > 0 || !serialized.ok) return;
        const bindings = [...serialized.ok.bindings];
        if (suppressId) {
            bindings.push({ role: SUPPRESS_ROLE, metricPointId: suppressId });
        }
        setSaving(true);
        setSaveError(null);
        try {
            await onSave({
                name: name.trim(),
                detector: "condition",
                params: { condition: serialized.ok.condition },
                bindings,
                severity,
                cooldownSeconds: parseInt(cooldown, 10),
            });
        } catch (e) {
            setSaveError(e instanceof Error ? e.message : "Failed to save rule");
            setSaving(false);
            return;
        }
        setSaving(false);
    }, [problems, serialized, suppressId, name, severity, cooldown, onSave]);

    return (
        <div className="fixed inset-0 z-70 flex flex-col bg-background">
            {/* Header */}
            <div className="flex items-center gap-3 px-4 h-12 border-b border-border shrink-0">
                <p className="text-sm font-semibold text-foreground shrink-0">Condition Builder</p>
                <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Rule name, e.g. Distribution pump without demand"
                    className={`${fieldCls} flex-1 min-w-0 max-w-md`}
                />
                <select
                    value={severity}
                    onChange={(e) => setSeverity(e.target.value as RuleSeverity)}
                    className={fieldCls}
                    title="Severity"
                >
                    <option value="INFO">Info</option>
                    <option value="WARNING">Warning</option>
                    <option value="ERROR">Error</option>
                    <option value="CRITICAL">Critical</option>
                </select>
                <div className="flex items-center gap-1" title="Cooldown between findings">
                    <input
                        type="text"
                        inputMode="numeric"
                        value={cooldown}
                        onChange={(e) => setCooldown(e.target.value)}
                        className={`${fieldCls} w-20 text-right`}
                    />
                    <span className="text-[10px] text-muted-foreground">sec</span>
                </div>
                <select
                    value={suppressId}
                    onChange={(e) => setSuppressId(e.target.value)}
                    className={`${fieldCls} max-w-56`}
                    title="Suppress evaluation while this bool signal is active"
                >
                    <option value="">No suppression</option>
                    {channels.map((c) => (
                        <option key={c.metricPointId} value={c.metricPointId}>
                            Suppress while: {c.assetName ?? c.deviceId} · {c.metricName}
                        </option>
                    ))}
                </select>
                <div className="flex-1" />
                <button
                    onClick={handleSave}
                    disabled={saving || problems.length > 0}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 shrink-0"
                >
                    {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                    {initialRule ? "Save changes" : "Create rule"}
                </button>
                <button
                    onClick={onClose}
                    className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
                    title="Close (Esc)"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>

            {/* Canvas */}
            <div className="flex-1 relative min-h-0">
                <BuilderContext.Provider value={context}>
                    <ReactFlow
                        nodes={nodes}
                        edges={edges}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        onConnect={onConnect}
                        nodeTypes={nodeTypes}
                        fitView
                        fitViewOptions={FIT_VIEW_OPTIONS}
                        deleteKeyCode={DELETE_KEY_CODES}
                        defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
                        proOptions={PRO_OPTIONS}
                        minZoom={0.3}
                        maxZoom={1.5}
                    >
                        <Background gap={16} size={1} />
                        <Controls showInteractive={false} />
                    </ReactFlow>
                </BuilderContext.Provider>

                {/* Palette */}
                <div className="absolute top-3 left-3 flex gap-2">
                    <button onClick={addCondition} className={paletteBtnCls}>
                        <Plus className="h-3.5 w-3.5" /> Condition
                    </button>
                    <button onClick={() => addGroup("all")} className={paletteBtnCls}>
                        <Plus className="h-3.5 w-3.5" /> AND group
                    </button>
                    <button onClick={() => addGroup("any")} className={paletteBtnCls}>
                        <Plus className="h-3.5 w-3.5" /> OR group
                    </button>
                    <button onClick={autoLayout} className={paletteBtnCls} title="Auto-arrange">
                        <LayoutGrid className="h-3.5 w-3.5" /> Arrange
                    </button>
                </div>
            </div>

            {/* Footer: live preview or validation problems */}
            <div className="px-4 py-2.5 border-t border-border shrink-0 min-h-11">
                {saveError && (
                    <p className="text-xs text-red-500 flex items-center gap-1.5">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {saveError}
                    </p>
                )}
                {!saveError && problems.length > 0 && (
                    <p className="text-xs text-amber-500 flex items-center gap-1.5">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {problems[0]}
                    </p>
                )}
                {!saveError && problems.length === 0 && serialized.ok && (
                    <p className="text-xs text-muted-foreground">
                        <span className="text-foreground font-medium">Fires when</span>{" "}
                        {serialized.ok.description}
                    </p>
                )}
            </div>
        </div>
    );
}
