"use client";

/**
 * GraphCanvas — Palantir-style visual graph editor built on React Flow.
 *
 * Renders the full site ontology as a draggable node graph with:
 * - Auto-layout via dagre (top-to-bottom hierarchy)
 * - Drag connection handles to create new links
 * - Click edge + backspace to delete links
 * - Minimap, zoom controls, fit-to-view, auto-layout button
 * - Link type selection popover on connect
 */

import { useCallback, useMemo, useState, useEffect } from "react";
import {
    ReactFlow,
    Background,
    Controls,
    MiniMap,
    useNodesState,
    useEdgesState,
    type Connection,
    type Edge,
    type Node,
    Panel,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { ObjectNode, type ObjectNodeData } from "./ObjectNode";
import { NodeDetail, EdgeDetail } from "./SelectionPanel";
import { computeLayout } from "./graph-layout";
import { updateObject } from "@/lib/api/graph";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import type { GraphObject, GraphLink, ApiLinkType, CreateLinkRequest } from "@/lib/api/types";
import { LayoutGrid, X } from "lucide-react";

const nodeTypes = { objectNode: ObjectNode };

const MINIMAP_CATEGORY_COLOR: Record<string, string> = {
    STRUCTURE: "#60a5fa",
    SPACE:     "#34d399",
    DEVICE:    "#fbbf24",
    SYSTEM:    "#a78bfa",
    CONTACT:   "#f472b6",
};

interface GraphCanvasProps {
    objects: GraphObject[];
    graphLinks: GraphLink[];
    linkTypes: ApiLinkType[];
    loading: boolean;
    error: string | null;
    onCreateLink: (data: CreateLinkRequest) => Promise<void>;
    onDeleteLink: (linkId: string) => Promise<void>;
    onRefresh: () => void;
}

export function GraphCanvas({
    objects,
    graphLinks,
    linkTypes,
    loading,
    error,
    onCreateLink,
    onDeleteLink,
    onRefresh,
}: GraphCanvasProps) {
    const [nodes, setNodes, onNodesChange] = useNodesState([] as Node[]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[]);

    // Pending connection (waiting for link type selection)
    const [pendingConnection, setPendingConnection] = useState<Connection | null>(null);
    const [connectLinkType, setConnectLinkType] = useState("");

    // Selection state
    const [selectedObject, setSelectedObject] = useState<GraphObject | null>(null);
    const [selectedLink, setSelectedLink] = useState<GraphLink | null>(null);

    // Run layout when data changes
    const doLayout = useCallback(() => {
        if (objects.length === 0) return;
        const { nodes: layoutNodes, edges: layoutEdges } = computeLayout(objects, graphLinks);
        setNodes(layoutNodes as Node[]);
        setEdges(layoutEdges as Edge[]);
    }, [objects, graphLinks, setNodes, setEdges]);

    useEffect(() => {
        doLayout();
    }, [doLayout]);

    // Derive effective link type — avoids empty select when async fetch completes after mount
    const effectiveLinkType = connectLinkType || (linkTypes.length > 0 ? linkTypes[0].name : "");

    // Node click → show detail panel
    const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
        const obj = objects.find((o) => o.id === node.id);
        if (obj) {
            setSelectedObject(obj);
            setSelectedLink(null);
        }
    }, [objects]);

    // Edge click → show detail panel
    const onEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
        const link = graphLinks.find((l) => l.id === edge.id);
        if (link) {
            setSelectedLink(link);
            setSelectedObject(null);
        }
    }, [graphLinks]);

    // Click on canvas background → deselect
    const onPaneClick = useCallback(() => {
        setSelectedObject(null);
        setSelectedLink(null);
    }, []);

    // Update object name
    const handleUpdateName = useCallback(async (objectId: string, displayName: string) => {
        await updateObject(objectId, displayName);
        onRefresh();
        setSelectedObject(null);
    }, [onRefresh]);

    // Delete link from detail panel
    const handleDeleteLink = useCallback(async (linkId: string) => {
        await onDeleteLink(linkId);
        setSelectedLink(null);
    }, [onDeleteLink]);

    // Handle new connection from drag
    const onConnect = useCallback((connection: Connection) => {
        if (!connection.source || !connection.target) return;
        setPendingConnection(connection);
    }, []);

    // Confirm the pending connection with selected link type
    const confirmConnection = useCallback(async () => {
        if (!pendingConnection?.source || !pendingConnection?.target || !effectiveLinkType) return;
        try {
            await onCreateLink({
                sourceId: pendingConnection.source,
                targetId: pendingConnection.target,
                linkTypeName: effectiveLinkType,
            });
        } catch {
            // error handled upstream
        }
        setPendingConnection(null);
    }, [pendingConnection, connectLinkType, onCreateLink]);

    // Handle edge deletion via keyboard (backspace/delete)
    const onEdgesDelete = useCallback(async (deletedEdges: Edge[]) => {
        for (const edge of deletedEdges) {
            try {
                await onDeleteLink(edge.id);
            } catch {
                // error handled upstream
            }
        }
    }, [onDeleteLink]);

    // Minimap node colour by category
    const minimapNodeColor = useCallback((node: Node) => {
        const cat = (node.data as Record<string, unknown>)?.objectTypeCategory as string | undefined;
        return MINIMAP_CATEGORY_COLOR[cat ?? ""] ?? "#94a3b8";
    }, []);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-[500px]">
                <LoadingSpinner size="lg" />
            </div>
        );
    }

    if (error) {
        return <p className="text-sm text-danger text-center py-8">{error}</p>;
    }

    if (objects.length === 0) {
        return (
            <p className="text-sm text-muted-foreground text-center py-12">
                No objects registered for this site yet.
            </p>
        );
    }

    return (
        <div className="h-[600px] w-full rounded-lg border border-border overflow-hidden bg-background relative">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onEdgesDelete={onEdgesDelete}
                onNodeClick={onNodeClick}
                onEdgeClick={onEdgeClick}
                onPaneClick={onPaneClick}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{ padding: 0.15 }}
                deleteKeyCode={["Backspace", "Delete"]}
                minZoom={0.2}
                maxZoom={2}
                proOptions={{ hideAttribution: true }}
            >
                <Background gap={16} size={1} />
                <Controls showInteractive={false} />
                <MiniMap
                    nodeColor={minimapNodeColor}
                    maskColor="rgba(0,0,0,0.08)"
                    className="bg-card! border-border!"
                />

                {/* Toolbar */}
                <Panel position="top-right" className="flex gap-1.5">
                    <Button variant="ghost" size="sm" onClick={doLayout} title="Auto Layout">
                        <LayoutGrid className="h-3.5 w-3.5 mr-1" />
                        Layout
                    </Button>
                </Panel>

                {/* Selection detail panel */}
                {selectedObject && (
                    <Panel position="top-left" className="mt-2 ml-2">
                        <NodeDetail
                            object={selectedObject}
                            onUpdateName={handleUpdateName}
                            onClose={() => setSelectedObject(null)}
                        />
                    </Panel>
                )}

                {selectedLink && (
                    <Panel position="top-left" className="mt-2 ml-2">
                        <EdgeDetail
                            link={selectedLink}
                            onDelete={handleDeleteLink}
                            onClose={() => setSelectedLink(null)}
                        />
                    </Panel>
                )}
            </ReactFlow>

            {/* Link type selector popover (shown when user drags a connection) */}
            {pendingConnection && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-[1px]">
                    <div className="bg-card border border-border rounded-xl shadow-lg p-4 w-72 space-y-3">
                        <div className="flex items-center justify-between">
                            <p className="text-sm font-semibold text-foreground">Choose Link Type</p>
                            <button
                                onClick={() => setPendingConnection(null)}
                                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>

                        <p className="text-xs text-muted-foreground">
                            {objects.find((o) => o.id === pendingConnection.source)?.displayName}
                            {" → "}
                            {objects.find((o) => o.id === pendingConnection.target)?.displayName}
                        </p>

                        <Select
                            label="Link Type"
                            value={effectiveLinkType}
                            onChange={(e) => setConnectLinkType(e.target.value)}
                        >
                            {linkTypes.map((lt) => (
                                <option key={lt.name} value={lt.name}>
                                    {lt.displayName}
                                </option>
                            ))}
                        </Select>

                        <div className="flex gap-2">
                            <Button size="sm" onClick={confirmConnection} disabled={!connectLinkType}>
                                Create Link
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setPendingConnection(null)}>
                                Cancel
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
