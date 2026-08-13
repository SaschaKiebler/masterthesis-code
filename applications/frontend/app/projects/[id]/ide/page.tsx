"use client";

/**
 * Project Build Page — the IDE workspace (ADR-012).
 * Three-panel layout: Object Tree | Visual Canvas | Detail Panel.
 * Uses the project graph endpoint to load objects + links across all project sites.
 */

import { use, useState, useCallback, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ReactFlowProvider } from "@xyflow/react";
import { IdeLayout } from "@/components/ide/IdeLayout";
import { ObjectTree } from "@/components/ide/ObjectTree";
import { OntologyCanvas } from "@/components/ide/OntologyCanvas";
import { ObjectDetailPanel } from "@/components/ide/ObjectDetailPanel";
import { CreateObjectModal } from "@/components/ide/CreateObjectModal";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { Button } from "@/components/ui/Button";
import { useProjectGraph, useProject } from "@/lib/hooks/useProjects";
import { useLinkTypes, useObjectTypes } from "@/lib/hooks/useGraph";
import { useAuth } from "@/lib/auth/AuthContext";
import { useTenants } from "@/lib/hooks/useTenants";
import type { GraphObject, GraphLink, CreateObjectRequest, CreateLinkRequest } from "@/lib/api/types";
import { ArrowLeft, Building2 } from "lucide-react";
import { SetupBuildingWizard } from "@/components/wizards/SetupBuildingWizard";
import { AddSensorWizard } from "@/components/wizards/AddSensorWizard";

interface BuildPageProps {
    params: Promise<{ id: string }>;
}

export default function BuildPage({ params }: BuildPageProps) {
    const { id: projectId } = use(params);
    const router = useRouter();
    const searchParams = useSearchParams();
    const graph = useProjectGraph(projectId);
    const { project } = useProject(projectId);
    const { linkTypes, loading: linkTypesLoading } = useLinkTypes();
    const { objectTypes, refresh: refreshObjectTypes } = useObjectTypes();
    const { activeTenant, tenants: memberTenants, globalRole } = useAuth();
    const { tenants: allTenants } = useTenants();

    // Resolve tenant: project.tenantId > activeTenant > first available tenant
    const isAdmin = globalRole === "system_admin" || globalRole === "consultant";
    const resolvedTenantId = project?.tenantId
        ?? activeTenant?.id
        ?? (isAdmin ? allTenants[0]?.id : memberTenants[0]?.id);

    // Create object modal
    const [showCreateObject, setShowCreateObject] = useState(false);
    const [createObjectCategory, setCreateObjectCategory] = useState<string | undefined>(undefined);

    // Wizards
    const [showBuildingWizard, setShowBuildingWizard] = useState(false);
    const [showSensorWizard, setShowSensorWizard] = useState(false);

    // ─── Shared selection state ───────────────────────────────────────────────

    const [selectedObject, setSelectedObject] = useState<GraphObject | null>(null);
    const [selectedLink, setSelectedLink] = useState<GraphLink | null>(null);

    const handleSelectObject = useCallback((obj: GraphObject | null) => {
        setSelectedObject(obj);
        if (obj) setSelectedLink(null);
    }, []);

    const handleSelectLink = useCallback((link: GraphLink | null) => {
        setSelectedLink(link);
        if (link) setSelectedObject(null);
    }, []);

    // ─── Actions ──────────────────────────────────────────────────────────────

    const handleUpdateName = useCallback(async (objectId: string, displayName: string) => {
        await graph.updateObjectName(objectId, displayName);
        setSelectedObject((prev) =>
            prev?.id === objectId ? { ...prev, displayName } : prev
        );
    }, [graph]);

    const handleCreateLink = useCallback(async (data: { sourceId: string; targetId: string; linkTypeName: string }) => {
        await graph.addLink(data);
    }, [graph]);

    const handleDeleteLink = useCallback(async (linkId: string) => {
        await graph.removeLink(linkId);
        setSelectedLink((prev) => (prev?.id === linkId ? null : prev));
    }, [graph]);

    const handleDeleteObject = useCallback(async (objectId: string) => {
        await graph.removeObject(objectId);
        setSelectedObject((prev) => (prev?.id === objectId ? null : prev));
    }, [graph]);

    const handleCreateObject = useCallback(async (objectTypeName: string, displayName: string) => {
        if (!resolvedTenantId) throw new Error("No tenant context — please ensure at least one tenant exists.");
        const created = await graph.addObject({ objectTypeName, displayName, tenantId: resolvedTenantId, projectId });
        handleSelectObject(created);
    }, [graph, resolvedTenantId, projectId, handleSelectObject]);

    const goToDashboard = useCallback(() => {
        router.push(`/projects/${projectId}`);
    }, [router, projectId]);

    const handleOpenCreateObject = useCallback((category?: string) => {
        setCreateObjectCategory(category);
        setShowCreateObject(true);
    }, []);

    const handleDuplicateObject = useCallback(async (objectId: string): Promise<GraphObject | undefined> => {
        const original = graph.objects.find((o) => o.id === objectId);
        if (!original || !resolvedTenantId) return undefined;
        const created = await graph.addObject({
            objectTypeName: original.objectTypeName,
            displayName: `${original.displayName} (Copy)`,
            tenantId: resolvedTenantId,
            projectId,
        });
        return created;
    }, [graph, resolvedTenantId, projectId]);

    const handleDuplicateObjects = useCallback(async (objectIds: string[]): Promise<GraphObject[]> => {
        if (!resolvedTenantId) return [];

        // 1. Create duplicate objects (no refresh yet)
        const objectItems: CreateObjectRequest[] = [];
        for (const id of objectIds) {
            const original = graph.objects.find((o) => o.id === id);
            if (!original) continue;
            objectItems.push({
                objectTypeName: original.objectTypeName,
                displayName: `${original.displayName} (Copy)`,
                tenantId: resolvedTenantId,
                projectId,
            });
        }
        const createdObjects = await graph.batchCreateObjects(objectItems);

        // 2. Build old→new ID map
        const idMap = new Map<string, string>();
        objectIds.forEach((oldId, index) => {
            if (createdObjects[index]) idMap.set(oldId, createdObjects[index].id);
        });

        // 3. Find links where both endpoints are in the selected set → recreate with new IDs
        const selectedSet = new Set(objectIds);
        const linkItems: CreateLinkRequest[] = [];
        for (const link of graph.links) {
            if (selectedSet.has(link.sourceId) && selectedSet.has(link.targetId)) {
                const newSourceId = idMap.get(link.sourceId);
                const newTargetId = idMap.get(link.targetId);
                if (newSourceId && newTargetId) {
                    linkItems.push({
                        sourceId: newSourceId,
                        targetId: newTargetId,
                        linkTypeName: link.linkTypeName,
                    });
                }
            }
        }
        if (linkItems.length > 0) {
            await graph.batchCreateLinks(linkItems);
        }

        // 4. Single refresh to pick up all new objects + links
        await graph.refresh();
        return createdObjects;
    }, [graph, resolvedTenantId, projectId]);

    // Auto-open wizard from deep-link query params (e.g. ?action=add-building)
    useEffect(() => {
        const action = searchParams.get("action");
        if (!action) return;
        if (action === "add-building") {
            setShowBuildingWizard(true);
        } else if (action === "add-sensor") {
            setShowSensorWizard(true);
        }
        // Remove query param to avoid re-triggering
        router.replace(`/projects/${projectId}/ide`, { scroll: false });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ─── Loading state ────────────────────────────────────────────────────────

    if (graph.loading && graph.objects.length === 0) {
        return (
            <div className="fixed inset-0 z-50 bg-background flex items-center justify-center">
                <LoadingSpinner size="lg" />
            </div>
        );
    }

    if (graph.error) {
        return (
            <div className="fixed inset-0 z-50 bg-background flex flex-col items-center justify-center gap-4">
                <p className="text-sm text-danger">{graph.error}</p>
                <Button variant="ghost" size="sm" onClick={() => router.back()}>
                    <ArrowLeft className="h-4 w-4 mr-1.5" /> Go Back
                </Button>
            </div>
        );
    }

    // ─── Render ───────────────────────────────────────────────────────────────

    return (
        <div className="fixed inset-0 z-50 bg-background">
            <IdeLayout
                left={
                    <ObjectTree
                        objects={graph.objects}
                        selectedObjectId={selectedObject?.id ?? null}
                        onSelectObject={handleSelectObject}
                        onCreateObject={handleOpenCreateObject}
                    />
                }
                center={
                    <ReactFlowProvider>
                        <OntologyCanvas
                            objects={graph.objects}
                            graphLinks={graph.links}
                            linkTypes={linkTypes}
                            selectedObjectId={selectedObject?.id ?? null}
                            selectedLinkId={selectedLink?.id ?? null}
                            onSelectObject={handleSelectObject}
                            onSelectLink={handleSelectLink}
                            onCreateLink={handleCreateLink}
                            onDeleteLink={handleDeleteLink}
                            onUpdateName={handleUpdateName}
                            onDeleteObject={handleDeleteObject}
                            onDuplicateObject={handleDuplicateObject}
                            onDuplicateObjects={handleDuplicateObjects}
                            onOpenDashboard={goToDashboard}
                        />
                    </ReactFlowProvider>
                }
                right={
                    <ObjectDetailPanel
                        projectId={projectId}
                        selectedObject={selectedObject}
                        selectedLink={selectedLink}
                        allObjects={graph.objects}
                        allLinks={graph.links}
                        linkTypes={linkTypes}
                        onUpdateName={handleUpdateName}
                        onDeleteObject={handleDeleteObject}
                        onCreateLink={handleCreateLink}
                        onDeleteLink={handleDeleteLink}
                        onSelectObject={handleSelectObject}
                        onSetupBuilding={() => setShowBuildingWizard(true)}
                        onAddSensor={() => setShowSensorWizard(true)}
                    />
                }
                statusBar={
                    <StatusBar
                        projectId={projectId}
                        objectCount={graph.objects.length}
                        linkCount={graph.links.length}
                        onBack={goToDashboard}
                    />
                }
            />
            <CreateObjectModal
                open={showCreateObject}
                onClose={() => setShowCreateObject(false)}
                objectTypes={objectTypes}
                preselectedCategory={createObjectCategory}
                onCreateObject={handleCreateObject}
                onRefreshObjectTypes={refreshObjectTypes}
            />
            {resolvedTenantId && (
                <>
                    <SetupBuildingWizard
                        open={showBuildingWizard}
                        onClose={() => setShowBuildingWizard(false)}
                        tenantId={resolvedTenantId}
                        projectId={projectId}
                        onComplete={() => graph.refresh()}
                    />
                    <AddSensorWizard
                        open={showSensorWizard}
                        onClose={() => setShowSensorWizard(false)}
                        tenantId={resolvedTenantId}
                        projectId={projectId}
                        objects={graph.objects}
                        objectTypes={objectTypes}
                        onComplete={() => graph.refresh()}
                    />
                </>
            )}
        </div>
    );
}

// ─── Status bar ───────────────────────────────────────────────────────────────

function StatusBar({
    projectId,
    objectCount,
    linkCount,
    onBack,
}: {
    projectId: string;
    objectCount: number;
    linkCount: number;
    onBack: () => void;
}) {
    return (
        <div className="flex items-center gap-3 w-full">
            <button
                onClick={onBack}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
                <ArrowLeft className="h-3 w-3" />
                Back to Dashboard
            </button>
            <span className="text-border">·</span>
            <span className="flex items-center gap-1">
                <Building2 className="h-3 w-3" />
                Project {projectId.slice(0, 8)}…
            </span>
            <span className="text-border">·</span>
            <span>{objectCount} items</span>
            <span className="text-border">·</span>
            <span>{linkCount} connections</span>
        </div>
    );
}
