"use client";

/**
 * SynopticView — Live SCADA-style topology view for the project overview.
 * Renders the ontology graph with live measurement values overlaid on nodes.
 *
 * Features:
 * - Auto-layout from dagre with manual drag-to-reposition
 * - Position persistence via backend API (localStorage as fast cache)
 * - Live measurement values on device nodes (10s refresh)
 * - Device connectivity status dots
 * - Fit-to-view on initial load
 */

import { useMemo, useCallback, useRef, useEffect, useState } from "react";
import {
    ReactFlow,
    Background,
    Controls,
    MiniMap,
    useNodesState,
    useEdgesState,
    type Node,
    type Edge,
    type NodeChange,
    type OnNodesChange,
    ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { LiveNode, type LiveNodeData } from "./LiveNode";
import { computeLayout, buildEdges } from "./graph-layout";

// SCADA-style nodes are much larger than IDE nodes
const SCADA_NODE_WIDTH = 200;
const SCADA_NODE_HEIGHT = 180;
import { useProjectLatestValues } from "@/lib/hooks/useProjectLatestValues";
import { useProjectHealth } from "@/lib/hooks/useProjectHealth";
import type { GraphObject, GraphLink } from "@/lib/api/types";
import type { DeviceHealth, ProjectSettings } from "@/lib/api/projects";
import { getProjectSettings, updateProjectSettings } from "@/lib/api/projects";
import { generateObjectTypeSvg } from "@/lib/api/graph";
import { Modal, ModalHeader, ModalContent, ModalFooter } from "@/components/ui/Modal";
import { Sparkles, RotateCcw, Sun, Moon } from "lucide-react";

const nodeTypes = { liveNode: LiveNode };

const MINIMAP_CATEGORY_COLOR: Record<string, string> = {
    STRUCTURE: "#60a5fa",
    SPACE:     "#34d399",
    DEVICE:    "#fbbf24",
    SYSTEM:    "#a78bfa",
    CONTACT:   "#f472b6",
};

interface SynopticViewProps {
    projectId: string;
    objects: GraphObject[];
    links: GraphLink[];
}

/** localStorage cache key — used as instant fallback while the API loads */
function cacheKey(projectId: string) {
    return `synoptic-positions:${projectId}`;
}

function loadCachedPositions(projectId: string): Record<string, { x: number; y: number }> | null {
    try {
        const raw = localStorage.getItem(cacheKey(projectId));
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

/** Persist positions to API + localStorage cache */
function persistPositions(projectId: string, nodes: Node[], settingsRef: React.MutableRefObject<ProjectSettings>) {
    const positions: Record<string, { x: number; y: number }> = {};
    for (const node of nodes) {
        positions[node.id] = { x: node.position.x, y: node.position.y };
    }
    // Update localStorage cache immediately
    try {
        localStorage.setItem(cacheKey(projectId), JSON.stringify(positions));
    } catch { /* quota exceeded */ }
    // Persist to backend
    const updated = { ...settingsRef.current, synopticPositions: positions };
    settingsRef.current = updated;
    updateProjectSettings(projectId, updated).catch((err) =>
        console.error("Failed to save synoptic positions:", err)
    );
}

function SynopticViewInner({ projectId, objects, links }: SynopticViewProps) {
    const { byObject } = useProjectLatestValues(projectId);
    const { health: projectHealth } = useProjectHealth(projectId);

    // Project settings ref — keeps latest settings for merging on save
    const settingsRef = useRef<ProjectSettings>({});
    // Track API-loaded positions to apply them once ready
    const [apiPositions, setApiPositions] = useState<Record<string, { x: number; y: number }> | null>(null);
    // Light/dark mode toggle for the synoptic view
    const [lightMode, setLightMode] = useState(false);

    // Load settings from API on mount
    useEffect(() => {
        getProjectSettings(projectId)
            .then((s) => {
                settingsRef.current = s;
                if (s.synopticLightMode) {
                    setLightMode(true);
                }
                if (s.synopticPositions && Object.keys(s.synopticPositions).length > 0) {
                    setApiPositions(s.synopticPositions);
                    // Update local cache
                    try {
                        localStorage.setItem(cacheKey(projectId), JSON.stringify(s.synopticPositions));
                    } catch { /* ignore */ }
                }
            })
            .catch((err) => console.error("Failed to load project settings:", err));
    }, [projectId]);

    function handleToggleLightMode() {
        const next = !lightMode;
        setLightMode(next);
        const updated = { ...settingsRef.current, synopticLightMode: next };
        settingsRef.current = updated;
        updateProjectSettings(projectId, updated).catch((err) =>
            console.error("Failed to save light mode preference:", err)
        );
    }

    // SVG generation state
    const [generating, setGenerating] = useState(false);
    const [genProgress, setGenProgress] = useState("");

    // Count object types that still need icons
    const missingIconCount = useMemo(() => {
        const seen = new Set<string>();
        let count = 0;
        for (const obj of objects) {
            if (!obj.objectTypeSvgIconUrl && !seen.has(obj.objectTypeName)) {
                seen.add(obj.objectTypeName);
                count++;
            }
        }
        return count;
    }, [objects]);

    async function handleGenerateIcons() {
        // Collect unique object type IDs that don't have SVG icons yet
        const typeMap = new Map<string, { id: string; name: string }>();
        for (const obj of objects) {
            if (!obj.objectTypeSvgIconUrl) {
                // We need the object type ID — it's not directly on GraphObject,
                // but we can use the objectTypeName to deduplicate
                // The generate endpoint takes objectType ID, we'll need to look it up
                typeMap.set(obj.objectTypeName, { id: obj.objectTypeName, name: obj.objectTypeDisplayName });
            }
        }

        if (typeMap.size === 0) {
            setGenProgress("All icons already generated");
            setTimeout(() => setGenProgress(""), 2000);
            return;
        }

        setGenerating(true);
        // We need actual ObjectType IDs. Fetch them first.
        try {
            const { getObjectTypes } = await import("@/lib/api/graph");
            const { objectTypes } = await getObjectTypes();

            const typesToGenerate = objectTypes.filter(
                ot => typeMap.has(ot.name) && !ot.svgIconUrl
            );

            for (let i = 0; i < typesToGenerate.length; i++) {
                const ot = typesToGenerate[i];
                setGenProgress(`Generating ${ot.displayName} (${i + 1}/${typesToGenerate.length})...`);
                try {
                    await generateObjectTypeSvg(ot.id);
                } catch (e) {
                    console.error(`Failed to generate SVG for ${ot.name}:`, e);
                }
            }
            setGenProgress(`Done! Generated ${typesToGenerate.length} icons.`);
            // Force page reload to pick up new SVG URLs from the graph API
            setTimeout(() => window.location.reload(), 1500);
        } catch (e) {
            setGenProgress("Generation failed");
            console.error(e);
        } finally {
            setGenerating(false);
        }
    }

    // Build device status lookup from health data
    const deviceStatusMap = useMemo<Record<string, DeviceHealth["status"]>>(() => {
        if (!projectHealth) return {};
        const map: Record<string, DeviceHealth["status"]> = {};
        for (const b of projectHealth.buildings) {
            for (const d of b.devices) {
                map[d.objectId] = d.status;
            }
        }
        return map;
    }, [projectHealth]);

    // Compute initial layout — use localStorage cache for instant render,
    // then re-apply once API positions arrive.
    const { initialNodes, initialEdges } = useMemo(() => {
        const { nodes: layoutNodes, edges: layoutEdges } = computeLayout(objects, links, {
            nodeWidth: SCADA_NODE_WIDTH,
            nodeHeight: SCADA_NODE_HEIGHT,
            nodesep: 100,
            ranksep: 120,
        });

        // Prefer API positions, fall back to localStorage cache
        const saved = apiPositions ?? loadCachedPositions(projectId);

        const nodes: Node<LiveNodeData>[] = layoutNodes.map((n) => {
            const savedPos = saved?.[n.id];
            return {
                ...n,
                type: "liveNode",
                position: savedPos ?? n.position,
                data: {
                    ...n.data,
                    svgIconUrl: objects.find(o => o.id === n.id)?.objectTypeSvgIconUrl,
                    liveValues: byObject[n.id] ?? [],
                    deviceStatus: deviceStatusMap[n.id],
                },
            };
        });

        // Rebuild edges with actual positions
        const posMap = new Map<string, { x: number; y: number }>();
        for (const n of nodes) {
            posMap.set(n.id, {
                x: n.position.x + SCADA_NODE_WIDTH / 2,
                y: n.position.y + SCADA_NODE_HEIGHT / 2,
            });
        }
        const edges = buildEdges(objects, links, posMap);

        return { initialNodes: nodes, initialEdges: edges };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [objects, links, projectId, apiPositions]); // Re-layout when API positions arrive

    const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
    const [edges, setEdges] = useEdgesState(initialEdges);

    // When API positions arrive after initial render, update node positions
    useEffect(() => {
        if (apiPositions) {
            setNodes((current) =>
                current.map((n) => {
                    const savedPos = apiPositions[n.id];
                    return savedPos ? { ...n, position: savedPos } : n;
                })
            );
            // Also rebuild edges
            const posMap = new Map<string, { x: number; y: number }>();
            setNodes((current) => {
                for (const n of current) {
                    posMap.set(n.id, {
                        x: n.position.x + SCADA_NODE_WIDTH / 2,
                        y: n.position.y + SCADA_NODE_HEIGHT / 2,
                    });
                }
                return current;
            });
            setEdges(buildEdges(objects, links, posMap));
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [apiPositions]);

    // Reset layout confirmation modal
    const [showResetConfirm, setShowResetConfirm] = useState(false);

    function handleResetLayout() {
        // Re-compute dagre layout from scratch (no saved positions)
        const { nodes: layoutNodes } = computeLayout(objects, links, {
            nodeWidth: SCADA_NODE_WIDTH,
            nodeHeight: SCADA_NODE_HEIGHT,
            nodesep: 100,
            ranksep: 120,
        });

        setNodes((current) =>
            current.map((n) => {
                const fresh = layoutNodes.find((ln) => ln.id === n.id);
                return fresh ? { ...n, position: fresh.position } : n;
            })
        );

        // Rebuild edges
        const posMap = new Map<string, { x: number; y: number }>();
        for (const ln of layoutNodes) {
            posMap.set(ln.id, {
                x: ln.position.x + SCADA_NODE_WIDTH / 2,
                y: ln.position.y + SCADA_NODE_HEIGHT / 2,
            });
        }
        setEdges(buildEdges(objects, links, posMap));

        // Clear saved positions
        try { localStorage.removeItem(cacheKey(projectId)); } catch { /* ignore */ }
        setApiPositions(null);
        const updated = { ...settingsRef.current };
        delete updated.synopticPositions;
        settingsRef.current = updated;
        updateProjectSettings(projectId, updated).catch((err) =>
            console.error("Failed to reset synoptic positions:", err)
        );

        setShowResetConfirm(false);
    }

    // Update live values on nodes without re-layout
    useEffect(() => {
        setNodes((current) =>
            current.map((n) => ({
                ...n,
                data: {
                    ...n.data,
                    liveValues: byObject[n.id] ?? [],
                    deviceStatus: deviceStatusMap[n.id],
                    svgIconUrl: objects.find(o => o.id === n.id)?.objectTypeSvgIconUrl,
                },
            }))
        );
    }, [byObject, deviceStatusMap, objects, setNodes]);

    // Save positions on drag end
    const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
    const handleNodesChange: OnNodesChange<Node<LiveNodeData>> = useCallback(
        (changes) => {
            onNodesChange(changes);

            // Debounce position saves
            const hasDrag = changes.some((c) => c.type === "position" && c.dragging === false);
            if (hasDrag) {
                clearTimeout(saveTimerRef.current);
                saveTimerRef.current = setTimeout(() => {
                    setNodes((current) => {
                        persistPositions(projectId, current, settingsRef);
                        return current;
                    });
                }, 500);
            }
        },
        [onNodesChange, projectId, setNodes]
    );

    return (
        <div className={`relative w-full h-full rounded-lg border border-border bg-card overflow-hidden ${lightMode ? "synoptic-light" : ""}`}>
            {/* Toolbar — top-right overlay */}
            <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
                {genProgress && (
                    <span className="text-xs text-muted-foreground bg-card/90 backdrop-blur px-2 py-1 rounded border border-border">
                        {genProgress}
                    </span>
                )}
                {missingIconCount > 0 && (
                    <button
                        type="button"
                        onClick={handleGenerateIcons}
                        disabled={generating}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-card border border-border text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors disabled:opacity-50"
                        title="Generate P&ID icons for all object types via AI"
                    >
                        <Sparkles className={`h-3.5 w-3.5 ${generating ? "animate-spin" : ""}`} />
                        {generating ? "Generating..." : `Generate Icons (${missingIconCount})`}
                    </button>
                )}
                <button
                    type="button"
                    onClick={handleToggleLightMode}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-card border border-border text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors"
                    title={lightMode ? "Switch to dark mode" : "Switch to light mode"}
                >
                    {lightMode ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
                    {lightMode ? "Dark" : "Light"}
                </button>
                <button
                    type="button"
                    onClick={() => setShowResetConfirm(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-card border border-border text-muted-foreground hover:text-foreground hover:border-destructive/50 transition-colors"
                    title="Reset node positions to automatic layout"
                >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reset Layout
                </button>
            </div>

            {/* Reset confirmation modal */}
            <Modal open={showResetConfirm} onClose={() => setShowResetConfirm(false)}>
                <ModalHeader onClose={() => setShowResetConfirm(false)}>
                    Reset Layout
                </ModalHeader>
                <ModalContent>
                    <p className="text-sm text-muted-foreground">
                        Are you sure you want to reset all node positions to the automatic layout?
                        Any manual positioning will be lost.
                    </p>
                </ModalContent>
                <ModalFooter>
                    <button
                        type="button"
                        onClick={() => setShowResetConfirm(false)}
                        className="px-4 py-2 rounded-lg text-sm font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={handleResetLayout}
                        className="px-4 py-2 rounded-lg text-sm font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
                    >
                        Reset
                    </button>
                </ModalFooter>
            </Modal>
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={handleNodesChange}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{ padding: 0.2 }}
                minZoom={0.1}
                maxZoom={2}
                defaultEdgeOptions={{
                    type: "smoothstep",
                    animated: false,
                }}
                colorMode={lightMode ? "light" : "dark"}
                proOptions={{ hideAttribution: true }}
            >
                <Background gap={20} size={1} />
                <Controls showInteractive={false} />
                <MiniMap
                    nodeColor={(n) => {
                        const cat = (n.data as LiveNodeData)?.objectTypeCategory;
                        return MINIMAP_CATEGORY_COLOR[cat] ?? "#94a3b8";
                    }}
                    maskColor="rgba(0,0,0,0.08)"
                    className="!bg-card !border-border"
                />
            </ReactFlow>
        </div>
    );
}

export function SynopticView(props: SynopticViewProps) {
    return (
        <ReactFlowProvider>
            <SynopticViewInner {...props} />
        </ReactFlowProvider>
    );
}
