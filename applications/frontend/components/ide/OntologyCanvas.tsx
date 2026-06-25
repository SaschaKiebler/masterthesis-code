"use client";

/**
 * OntologyCanvas — center panel of the IDE.
 * Enhanced React Flow graph editor with:
 * - Click node → select (syncs tree + detail panel)
 * - Double-click node → quick-action popup (rename, duplicate, delete, add link)
 * - Drag handle → create link (with link type popover)
 * - Click edge → select (detail panel shows link info)
 * - Backspace → delete selected edge
 * - Shift+click / Shift+drag → multi-select
 * - Ctrl/Cmd+D → duplicate selected objects
 * - Toolbar: auto-layout toggle, manual layout, zoom-to-fit
 */

import { useState, useCallback, useEffect, useRef } from "react";
import {
    ReactFlow,
    Background,
    Controls,
    MiniMap,
    Panel,
    useNodesState,
    useEdgesState,
    useReactFlow,
    type Connection,
    type Edge,
    type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { ObjectNode, type ObjectNodeData } from "@/components/graph/ObjectNode";
import { computeLayout, buildEdges, NODE_WIDTH, NODE_HEIGHT } from "@/components/graph/graph-layout";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import type { GraphObject, GraphLink, ApiLinkType, CreateLinkRequest } from "@/lib/api/types";
import { LayoutGrid, Maximize2, X, Pencil, Trash2, ArrowRightLeft, Lock, Unlock, Copy } from "lucide-react";

const nodeTypes = { objectNode: ObjectNode };

// Stable references for React Flow props. Inline object/array literals here make
// React Flow's StoreUpdater re-sync (setState) on every render — combined with any
// repeated render that becomes a "Maximum update depth exceeded" loop.
const FIT_VIEW_OPTIONS = { padding: 0.15 };
const DELETE_KEY_CODES = ["Backspace", "Delete"];
const PRO_OPTIONS = { hideAttribution: true };

const MINIMAP_CATEGORY_COLOR: Record<string, string> = {
    STRUCTURE: "#60a5fa",
    SPACE:     "#34d399",
    DEVICE:    "#fbbf24",
    SYSTEM:    "#a78bfa",
    CONTACT:   "#f472b6",
};

// ─── Quick-action popup state ─────────────────────────────────────────────────

interface QuickAction {
    objectId: string;
    screenX: number;
    screenY: number;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface OntologyCanvasProps {
    objects: GraphObject[];
    graphLinks: GraphLink[];
    linkTypes: ApiLinkType[];
    selectedObjectId: string | null;
    selectedLinkId: string | null;
    onSelectObject: (object: GraphObject | null) => void;
    onSelectLink: (link: GraphLink | null) => void;
    onCreateLink: (data: CreateLinkRequest) => Promise<void>;
    onDeleteLink: (linkId: string) => Promise<void>;
    onUpdateName: (objectId: string, displayName: string) => Promise<void>;
    onDeleteObject?: (objectId: string) => Promise<void>;
    onDuplicateObject?: (objectId: string) => Promise<GraphObject | undefined>;
    onDuplicateObjects?: (objectIds: string[]) => Promise<GraphObject[]>;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function OntologyCanvas({
    objects,
    graphLinks,
    linkTypes,
    selectedObjectId,
    selectedLinkId,
    onSelectObject,
    onSelectLink,
    onCreateLink,
    onDeleteLink,
    onUpdateName,
    onDeleteObject,
    onDuplicateObject,
    onDuplicateObjects,
}: OntologyCanvasProps) {
    const [nodes, setNodes, onNodesChange] = useNodesState([] as Node[]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[]);
    const reactFlowInstance = useReactFlow();

    // Pending connection (link type selection)
    const [pendingConnection, setPendingConnection] = useState<Connection | null>(null);
    const [connectLinkType, setConnectLinkType] = useState("");

    // Quick-action popup
    const [quickAction, setQuickAction] = useState<QuickAction | null>(null);
    const [renameValue, setRenameValue] = useState("");
    const [renaming, setRenaming] = useState(false);
    const renameInputRef = useRef<HTMLInputElement>(null);

    // Auto-layout toggle (OFF by default — nodes keep their positions)
    const [autoLayoutEnabled, setAutoLayoutEnabled] = useState(false);

    // Track object IDs for incremental updates
    const prevObjectIdsRef = useRef<Set<string> | undefined>(undefined);
    const isInitialLoadRef = useRef(true);

    // Multi-selection tracking
    const selectedNodeIdsRef = useRef<Set<string>>(new Set());

    // Always-current selected id — read in callbacks/effects that must not echo the
    // selection back into external state (prevents the selection sync feedback loop).
    const selectedObjectIdRef = useRef(selectedObjectId);
    selectedObjectIdRef.current = selectedObjectId;

    // Placement hints for duplicate operations
    const placementHintRef = useRef<Map<string, { x: number; y: number }>>(new Map());

    const effectiveLinkType = connectLinkType || (linkTypes.length > 0 ? linkTypes[0].name : "");

    // ─── Layout ───────────────────────────────────────────────────────────────

    const doLayout = useCallback(() => {
        if (objects.length === 0) { setNodes([]); setEdges([]); return; }
        const { nodes: ln, edges: le } = computeLayout(objects, graphLinks);
        setNodes(ln as Node[]);
        setEdges(le as Edge[]);
    }, [objects, graphLinks, setNodes, setEdges]);

    // Smart layout effect: full Dagre on initial load or auto-on, incremental otherwise
    useEffect(() => {
        if (objects.length === 0) {
            setNodes([]);
            setEdges([]);
            isInitialLoadRef.current = false;
            prevObjectIdsRef.current = new Set<string>();
            return;
        }

        // Initial load or auto layout enabled → full Dagre
        if (isInitialLoadRef.current || autoLayoutEnabled) {
            const { nodes: ln, edges: le } = computeLayout(objects, graphLinks);
            setNodes(ln as Node[]);
            setEdges(le as Edge[]);
            isInitialLoadRef.current = false;
            prevObjectIdsRef.current = new Set(objects.map((o) => o.id));
            return;
        }

        // Incremental update (auto layout OFF)
        const currentNodes = reactFlowInstance.getNodes();

        // No existing nodes to preserve (e.g. StrictMode double-render) → fall back to Dagre
        if (currentNodes.length === 0) {
            const { nodes: ln, edges: le } = computeLayout(objects, graphLinks);
            setNodes(ln as Node[]);
            setEdges(le as Edge[]);
            prevObjectIdsRef.current = new Set(objects.map((o) => o.id));
            return;
        }

        const currentPosMap = new Map<string, { x: number; y: number }>();
        for (const node of currentNodes) {
            currentPosMap.set(node.id, {
                x: node.position.x + NODE_WIDTH / 2,
                y: node.position.y + NODE_HEIGHT / 2,
            });
        }

        const prevIds = prevObjectIdsRef.current ?? new Set<string>();
        const newObjectIds = new Set(objects.filter((o) => !prevIds.has(o.id)).map((o) => o.id));

        // Viewport center for placing new nodes without a placement hint
        let centerFlow = { x: 400, y: 300 };
        try {
            const bounds = document.querySelector(".react-flow")?.getBoundingClientRect();
            if (bounds) {
                centerFlow = reactFlowInstance.screenToFlowPosition({
                    x: bounds.width / 2,
                    y: bounds.height / 2,
                });
            }
        } catch { /* fallback to default */ }

        let newNodeOffset = 0;
        const updatedNodes: Node<ObjectNodeData>[] = objects.map((obj) => {
            if (newObjectIds.has(obj.id)) {
                // New node — check placement hint, then fall back to viewport center
                const hint = placementHintRef.current.get(obj.id);
                let pos: { x: number; y: number };
                if (hint) {
                    pos = hint;
                    placementHintRef.current.delete(obj.id);
                } else {
                    pos = { x: centerFlow.x + newNodeOffset, y: centerFlow.y + newNodeOffset };
                    newNodeOffset += 30;
                }
                currentPosMap.set(obj.id, { x: pos.x + NODE_WIDTH / 2, y: pos.y + NODE_HEIGHT / 2 });
                return {
                    id: obj.id,
                    type: "objectNode" as const,
                    width: NODE_WIDTH,
                    height: NODE_HEIGHT,
                    position: pos,
                    selected: obj.id === selectedObjectIdRef.current,
                    data: {
                        displayName: obj.displayName ?? obj.id,
                        objectTypeName: obj.objectTypeName,
                        objectTypeDisplayName: obj.objectTypeDisplayName,
                        objectTypeCategory: obj.objectTypeCategory,
                    },
                };
            }
            // Existing node — preserve position, update data
            const existingNode = currentNodes.find((n) => n.id === obj.id);
            return {
                id: obj.id,
                type: "objectNode" as const,
                width: NODE_WIDTH,
                height: NODE_HEIGHT,
                position: existingNode?.position ?? { x: 0, y: 0 },
                selected: obj.id === selectedObjectIdRef.current,
                data: {
                    displayName: obj.displayName ?? obj.id,
                    objectTypeName: obj.objectTypeName,
                    objectTypeDisplayName: obj.objectTypeDisplayName,
                    objectTypeCategory: obj.objectTypeCategory,
                },
            };
        });

        const updatedEdges = buildEdges(objects, graphLinks, currentPosMap);
        setNodes(updatedNodes as Node[]);
        setEdges(updatedEdges as Edge[]);
        prevObjectIdsRef.current = new Set(objects.map((o) => o.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps — reactFlowInstance is used imperatively, not as a reactive dependency
    }, [objects, graphLinks, autoLayoutEnabled, setNodes, setEdges]);

    const fitView = useCallback(() => {
        reactFlowInstance.fitView({ padding: 0.15, duration: 300 });
    }, [reactFlowInstance]);

    // ─── Selection sync ───────────────────────────────────────────────────────

    // Highlight selected node from external state (tree/detail panel)
    // Skip when multi-selection is active on canvas
    useEffect(() => {
        if (selectedNodeIdsRef.current.size > 1) return;
        setNodes((nds) => {
            let changed = false;
            const next = nds.map((n) => {
                const selected = n.id === selectedObjectId;
                if (!!n.selected === selected) return n;
                changed = true;
                return { ...n, selected };
            });
            return changed ? next : nds;
        });
    }, [selectedObjectId, setNodes]);

    // Highlight selected edge from external state
    useEffect(() => {
        setEdges((eds) =>
            eds.map((e) => ({
                ...e,
                selected: e.id === selectedLinkId,
            }))
        );
    }, [selectedLinkId, setEdges]);

    // Track selection changes from canvas interactions
    const onSelectionChange = useCallback(({ nodes: selectedNodes }: { nodes: Node[]; edges: Edge[] }) => {
        // Only track the multi-selection set here (used for Ctrl/Cmd+D duplicate).
        // Single-node → external state is driven by onNodeClick, NOT here: this handler
        // also fires for *programmatic* selection (our selectedObjectId effect), and
        // echoing that back creates an external↔canvas selection feedback loop.
        selectedNodeIdsRef.current = new Set(selectedNodes.map((n) => n.id));
    }, []);

    // ─── Node interactions ────────────────────────────────────────────────────

    const onNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
        // Shift+click is handled by React Flow's multi-select; don't override
        if (!event.shiftKey) {
            const obj = objects.find((o) => o.id === node.id);
            if (obj) onSelectObject(obj);
        }
        setQuickAction(null);
    }, [objects, onSelectObject]);

    const onNodeDoubleClick = useCallback((event: React.MouseEvent, node: Node) => {
        event.stopPropagation();
        const obj = objects.find((o) => o.id === node.id);
        if (!obj) return;
        onSelectObject(obj);
        setRenameValue(obj.displayName);
        setRenaming(false);
        setQuickAction({
            objectId: obj.id,
            screenX: event.clientX,
            screenY: event.clientY,
        });
    }, [objects, onSelectObject]);

    // ─── Edge interactions ────────────────────────────────────────────────────

    const onEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
        const link = graphLinks.find((l) => l.id === edge.id);
        if (link) onSelectLink(link);
        setQuickAction(null);
    }, [graphLinks, onSelectLink]);

    // ─── Pane click → deselect ────────────────────────────────────────────────

    const onPaneClick = useCallback(() => {
        onSelectObject(null);
        onSelectLink(null);
        setQuickAction(null);
    }, [onSelectObject, onSelectLink]);

    // ─── Connection (create link) ─────────────────────────────────────────────

    const onConnect = useCallback((connection: Connection) => {
        if (!connection.source || !connection.target) return;
        setPendingConnection(connection);
    }, []);

    const swapConnection = useCallback(() => {
        setPendingConnection((prev) => {
            if (!prev) return prev;
            return { ...prev, source: prev.target, target: prev.source, sourceHandle: prev.targetHandle, targetHandle: prev.sourceHandle };
        });
    }, []);

    const confirmConnection = useCallback(async () => {
        if (!pendingConnection?.source || !pendingConnection?.target || !effectiveLinkType) return;
        try {
            await onCreateLink({
                sourceId: pendingConnection.source,
                targetId: pendingConnection.target,
                linkTypeName: effectiveLinkType,
            });
        } catch { /* handled upstream */ }
        setPendingConnection(null);
    }, [pendingConnection, effectiveLinkType, onCreateLink]);

    // ─── Edge deletion (backspace) ────────────────────────────────────────────

    const onEdgesDelete = useCallback(async (deletedEdges: Edge[]) => {
        for (const edge of deletedEdges) {
            try { await onDeleteLink(edge.id); } catch { /* handled upstream */ }
        }
    }, [onDeleteLink]);

    // ─── Quick-action handlers ────────────────────────────────────────────────

    const handleQuickRename = useCallback(async () => {
        if (!quickAction || !renameValue.trim()) return;
        try {
            await onUpdateName(quickAction.objectId, renameValue.trim());
            setQuickAction(null);
        } catch { /* handled upstream */ }
    }, [quickAction, renameValue, onUpdateName]);

    const handleQuickDelete = useCallback(async () => {
        if (!quickAction || !onDeleteObject) return;
        try {
            await onDeleteObject(quickAction.objectId);
            setQuickAction(null);
        } catch { /* handled upstream */ }
    }, [quickAction, onDeleteObject]);

    // ─── Duplicate handlers ──────────────────────────────────────────────────

    const handleDuplicate = useCallback(async (objectId: string) => {
        if (!onDuplicateObject) return;
        const currentNodes = reactFlowInstance.getNodes();
        const originalNode = currentNodes.find((n) => n.id === objectId);
        const created = await onDuplicateObject(objectId);
        if (created && originalNode) {
            placementHintRef.current.set(created.id, {
                x: originalNode.position.x + 30,
                y: originalNode.position.y + 30,
            });
        }
    }, [onDuplicateObject, reactFlowInstance]);

    const handleDuplicateMultiple = useCallback(async (objectIds: string[]) => {
        if (!onDuplicateObjects) return;
        const currentNodes = reactFlowInstance.getNodes();
        const createdObjects = await onDuplicateObjects(objectIds);
        createdObjects.forEach((created, index) => {
            const originalId = objectIds[index];
            const originalNode = currentNodes.find((n) => n.id === originalId);
            if (originalNode) {
                placementHintRef.current.set(created.id, {
                    x: originalNode.position.x + 30,
                    y: originalNode.position.y + 30,
                });
            }
        });
    }, [onDuplicateObjects, reactFlowInstance]);

    const handleQuickDuplicate = useCallback(async () => {
        if (!quickAction) return;
        await handleDuplicate(quickAction.objectId);
        setQuickAction(null);
    }, [quickAction, handleDuplicate]);

    // ─── Keyboard shortcut: Ctrl/Cmd+D → duplicate ──────────────────────────

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "d") {
                e.preventDefault();
                const ids = selectedNodeIdsRef.current;
                if (ids.size > 1) {
                    handleDuplicateMultiple([...ids]);
                } else if (ids.size === 1) {
                    handleDuplicate([...ids][0]);
                } else if (selectedObjectId) {
                    handleDuplicate(selectedObjectId);
                }
            }
        };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, [selectedObjectId, handleDuplicate, handleDuplicateMultiple]);

    // ─── Minimap colours ──────────────────────────────────────────────────────

    const minimapNodeColor = useCallback((node: Node) => {
        const cat = (node.data as Record<string, unknown>)?.objectTypeCategory as string | undefined;
        return MINIMAP_CATEGORY_COLOR[cat ?? ""] ?? "#94a3b8";
    }, []);

    // ─── Render ───────────────────────────────────────────────────────────────

    return (
        <div className="h-full w-full relative">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onEdgesDelete={onEdgesDelete}
                onNodeClick={onNodeClick}
                onNodeDoubleClick={onNodeDoubleClick}
                onEdgeClick={onEdgeClick}
                onPaneClick={onPaneClick}
                onSelectionChange={onSelectionChange}
                selectionKeyCode="Shift"
                multiSelectionKeyCode="Shift"
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={FIT_VIEW_OPTIONS}
                deleteKeyCode={DELETE_KEY_CODES}
                minZoom={0.1}
                maxZoom={3}
                proOptions={PRO_OPTIONS}
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
                    <Button
                        variant={autoLayoutEnabled ? "primary" : "ghost"}
                        size="sm"
                        onClick={() => setAutoLayoutEnabled((v) => !v)}
                        title={autoLayoutEnabled ? "Auto-layout ON — nodes reposition on every change" : "Auto-layout OFF — nodes stay where you put them"}
                    >
                        {autoLayoutEnabled
                            ? <><Unlock className="h-3.5 w-3.5 mr-1" /> Auto</>
                            : <><Lock className="h-3.5 w-3.5 mr-1" /> Manual</>
                        }
                    </Button>
                    <Button variant="ghost" size="sm" onClick={doLayout} title="Re-layout all nodes (Dagre)">
                        <LayoutGrid className="h-3.5 w-3.5 mr-1" /> Layout
                    </Button>
                    <Button variant="ghost" size="sm" onClick={fitView} title="Zoom to Fit">
                        <Maximize2 className="h-3.5 w-3.5" />
                    </Button>
                </Panel>
            </ReactFlow>

            {/* Quick-action popup (on double-click) */}
            {quickAction && (
                <QuickActionPopup
                    action={quickAction}
                    object={objects.find((o) => o.id === quickAction.objectId)!}
                    renameValue={renameValue}
                    setRenameValue={setRenameValue}
                    renaming={renaming}
                    setRenaming={setRenaming}
                    onRename={handleQuickRename}
                    onDuplicate={onDuplicateObject ? handleQuickDuplicate : undefined}
                    onDelete={onDeleteObject ? handleQuickDelete : undefined}
                    onClose={() => setQuickAction(null)}
                    renameInputRef={renameInputRef}
                />
            )}

            {/* Link type selector popover (on drag-connect) */}
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
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <span className="truncate font-medium text-foreground">
                                {objects.find((o) => o.id === pendingConnection.source)?.displayName}
                            </span>
                            <span>→</span>
                            <span className="truncate font-medium text-foreground">
                                {objects.find((o) => o.id === pendingConnection.target)?.displayName}
                            </span>
                            <button
                                onClick={swapConnection}
                                title="Swap direction"
                                className="ml-auto p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
                            >
                                <ArrowRightLeft className="h-3.5 w-3.5" />
                            </button>
                        </div>
                        <Select
                            label="Link Type"
                            value={effectiveLinkType}
                            onChange={(e) => setConnectLinkType(e.target.value)}
                        >
                            {linkTypes.map((lt) => (
                                <option key={lt.name} value={lt.name}>{lt.displayName}</option>
                            ))}
                        </Select>
                        <div className="flex gap-2">
                            <Button size="sm" onClick={confirmConnection} disabled={!effectiveLinkType}>
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

// ─── Quick-action popup component ─────────────────────────────────────────────

interface QuickActionPopupProps {
    action: QuickAction;
    object: GraphObject;
    renameValue: string;
    setRenameValue: (v: string) => void;
    renaming: boolean;
    setRenaming: (v: boolean) => void;
    onRename: () => Promise<void>;
    onDuplicate?: () => Promise<void>;
    onDelete?: () => Promise<void>;
    onClose: () => void;
    renameInputRef: React.RefObject<HTMLInputElement | null>;
}

function QuickActionPopup({
    action,
    object,
    renameValue,
    setRenameValue,
    renaming,
    setRenaming,
    onRename,
    onDuplicate,
    onDelete,
    onClose,
    renameInputRef,
}: QuickActionPopupProps) {
    if (!object) return null;

    return (
        <div
            className="fixed z-60 bg-card border border-border rounded-xl shadow-xl w-64 overflow-hidden"
            style={{
                left: Math.min(action.screenX, window.innerWidth - 280),
                top: Math.min(action.screenY, window.innerHeight - 200),
            }}
        >
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                <p className="text-sm font-medium text-foreground truncate">{object.displayName}</p>
                <button
                    onClick={onClose}
                    className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                    <X className="h-3.5 w-3.5" />
                </button>
            </div>

            {renaming ? (
                <div className="p-3 space-y-2">
                    <input
                        ref={renameInputRef}
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") onRename();
                            if (e.key === "Escape") { setRenaming(false); }
                        }}
                        autoFocus
                        className="w-full h-8 px-2.5 text-sm bg-background border border-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <div className="flex gap-2">
                        <Button size="sm" onClick={onRename} disabled={!renameValue.trim()}>Save</Button>
                        <Button size="sm" variant="ghost" onClick={() => setRenaming(false)}>Cancel</Button>
                    </div>
                </div>
            ) : (
                <div className="py-1">
                    <QuickActionButton icon={Pencil} label="Rename" onClick={() => setRenaming(true)} />
                    {onDuplicate && (
                        <QuickActionButton icon={Copy} label="Duplicate" onClick={onDuplicate} />
                    )}
                    {onDelete && (
                        <QuickActionButton icon={Trash2} label="Delete" onClick={onDelete} danger />
                    )}
                </div>
            )}
        </div>
    );
}

function QuickActionButton({
    icon: Icon,
    label,
    onClick,
    danger,
}: {
    icon: React.ElementType;
    label: string;
    onClick: () => void;
    danger?: boolean;
}) {
    return (
        <button
            onClick={onClick}
            className={`flex items-center gap-2.5 w-full px-3 py-1.5 text-sm transition-colors ${
                danger
                    ? "text-danger hover:bg-danger/10"
                    : "text-foreground hover:bg-muted"
            }`}
        >
            <Icon className="h-3.5 w-3.5" />
            {label}
        </button>
    );
}
