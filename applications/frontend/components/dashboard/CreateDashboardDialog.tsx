"use client";

/**
 * CreateDashboardDialog — scope picker for new dashboards.
 * Lets the consultant choose between a project-wide dashboard
 * or one scoped from the selected node downward in the ontology tree.
 */

import { useState, useCallback } from "react";
import { Modal, ModalHeader, ModalContent, ModalFooter } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useDashboards } from "@/lib/hooks/useDashboards";
import type { GraphObject, GraphLink } from "@/lib/api/types";
import { Globe, GitBranch } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface CreateDashboardDialogProps {
    open: boolean;
    onClose: () => void;
    projectId: string;
    selectedObject: GraphObject | null;
    allObjects: GraphObject[];
    allLinks: GraphLink[];
    onCreated: (dashboardId: string) => void;
}

type ScopeChoice = "project" | "node";

export function CreateDashboardDialog({
    open,
    onClose,
    projectId,
    selectedObject,
    allObjects,
    allLinks,
    onCreated,
}: CreateDashboardDialogProps) {
    const { create } = useDashboards(projectId);
    const [scope, setScope] = useState<ScopeChoice>("project");
    const [name, setName] = useState("");
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Reset state when dialog opens
    const handleClose = useCallback(() => {
        setScope("project");
        setName("");
        setError(null);
        onClose();
    }, [onClose]);

    const defaultName = scope === "project"
        ? "Project Dashboard"
        : `Dashboard — ${selectedObject?.displayName ?? "Node"}`;

    const handleCreate = useCallback(async () => {
        setCreating(true);
        setError(null);
        try {
            const dashboard = await create({
                name: name.trim() || defaultName,
                scopeType: scope === "node" && selectedObject ? selectedObject.objectTypeName : undefined,
                scopeId: scope === "node" && selectedObject ? selectedObject.id : undefined,
            });
            handleClose();
            onCreated(dashboard.id);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to create dashboard");
        } finally {
            setCreating(false);
        }
    }, [create, name, defaultName, scope, selectedObject, handleClose, onCreated]);

    return (
        <Modal open={open} onClose={handleClose}>
            <ModalHeader onClose={handleClose}>New Dashboard</ModalHeader>
            <ModalContent>
                <div className="space-y-4">
                    {/* Scope selection */}
                    <div>
                        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">
                            Scope
                        </label>
                        <div className="grid grid-cols-2 gap-3">
                            <ScopeCard
                                icon={Globe}
                                title="Project-wide"
                                description="All assets across the entire project"
                                selected={scope === "project"}
                                onClick={() => setScope("project")}
                            />
                            <ScopeCard
                                icon={GitBranch}
                                title={`From "${selectedObject?.displayName ?? "node"}" down`}
                                description="This node and everything below it"
                                selected={scope === "node"}
                                onClick={() => setScope("node")}
                                disabled={!selectedObject}
                            />
                        </div>
                    </div>

                    {/* Name input */}
                    <div>
                        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">
                            Dashboard Name
                        </label>
                        <input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder={defaultName}
                            className="w-full h-9 px-3 text-sm bg-background border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                            onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
                        />
                    </div>

                    {error && (
                        <p className="text-xs text-danger">{error}</p>
                    )}
                </div>
            </ModalContent>
            <ModalFooter>
                <Button variant="ghost" onClick={handleClose}>Cancel</Button>
                <Button onClick={handleCreate} loading={creating}>
                    Create Dashboard
                </Button>
            </ModalFooter>
        </Modal>
    );
}

// ─── Scope card ──────────────────────────────────────────────────────────────

function ScopeCard({
    icon: Icon,
    title,
    description,
    selected,
    onClick,
    disabled,
}: {
    icon: React.ElementType;
    title: string;
    description: string;
    selected: boolean;
    onClick: () => void;
    disabled?: boolean;
}) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={cn(
                "flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all text-center",
                selected
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/40 hover:bg-muted/30",
                disabled && "opacity-40 cursor-not-allowed"
            )}
        >
            <Icon className={cn("h-6 w-6", selected ? "text-primary" : "text-muted-foreground")} />
            <div>
                <p className={cn("text-sm font-medium", selected ? "text-foreground" : "text-muted-foreground")}>
                    {title}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{description}</p>
            </div>
        </button>
    );
}
