"use client";

/**
 * Projects List Page — the primary workspace for consultants (ADR-012).
 * Shows all projects as cards with create functionality.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/Header";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal, ModalHeader, ModalContent, ModalFooter } from "@/components/ui/Modal";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { useProjects } from "@/lib/hooks/useProjects";
import { useAuth } from "@/lib/auth/AuthContext";
import { useTenants } from "@/lib/hooks/useTenants";
import { Plus, FolderOpen, Building2, ArrowRight, Calendar, Trash2 } from "lucide-react";

export default function ProjectsPage() {
    const router = useRouter();
    const { projects, loading, error, refresh, create, remove } = useProjects();
    const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
    const [deleting, setDeleting] = useState(false);
    const { activeTenant, tenants: memberTenants, globalRole } = useAuth();
    const { tenants: allTenants } = useTenants();
    const [showCreate, setShowCreate] = useState(false);
    const [selectedTenantId, setSelectedTenantId] = useState<string>("");

    // System admins / consultants can see all tenants; regular users only their memberships
    const isAdmin = globalRole === "system_admin" || globalRole === "consultant";
    const availableTenants = isAdmin && memberTenants.length === 0
        ? allTenants.map((t) => ({ id: t.id, name: t.name }))
        : memberTenants.map((t) => ({ id: t.id, name: t.name }));
    const [createName, setCreateName] = useState("");
    const [createDesc, setCreateDesc] = useState("");
    const [creating, setCreating] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);

    const effectiveTenantId = activeTenant?.id ?? (selectedTenantId || availableTenants[0]?.id);

    async function handleCreate() {
        if (!createName.trim()) return;
        if (!effectiveTenantId) {
            setCreateError("No tenant available. Please create a tenant first.");
            return;
        }
        setCreating(true);
        setCreateError(null);
        try {
            const project = await create({
                name: createName.trim(),
                description: createDesc.trim() || undefined,
                tenantId: effectiveTenantId,
            });
            setShowCreate(false);
            setCreateName("");
            setCreateDesc("");
            router.push(`/projects/${project.id}`);
        } catch (e) {
            setCreateError(e instanceof Error ? e.message : "Failed to create project");
        } finally {
            setCreating(false);
        }
    }

    async function handleDeleteConfirm() {
        if (!deleteTarget) return;
        setDeleting(true);
        try {
            await remove(deleteTarget.id);
            setDeleteTarget(null);
        } catch (e) {
            setDeleteError(e instanceof Error ? e.message : "Failed to delete project");
        } finally {
            setDeleting(false);
        }
    }
    const [deleteError, setDeleteError] = useState<string | null>(null);

    return (
        <div className="min-h-screen bg-background">
            <Header
                title="Projects"
                subtitle="Your building monitoring projects"
                breadcrumbs={[
                    { label: "Dashboard", href: "/" },
                    { label: "Projects" },
                ]}
                actions={
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={() => setShowCreate(true)}
                    >
                        <Plus className="h-4 w-4 mr-1.5" />
                        New Project
                    </Button>
                }
            />

            <div className="p-4 md:p-8">
                {loading && projects.length === 0 && (
                    <div className="flex justify-center py-16">
                        <LoadingSpinner size="lg" />
                    </div>
                )}

                {error && (
                    <ErrorMessage
                        title="Failed to load projects"
                        message={error}
                        onRetry={refresh}
                    />
                )}

                {!loading && !error && projects.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                        <div className="p-4 rounded-full bg-primary/10 mb-4">
                            <FolderOpen className="h-10 w-10 text-primary" />
                        </div>
                        <h2 className="text-lg font-semibold text-foreground mb-2">No projects yet</h2>
                        <p className="text-sm text-muted-foreground max-w-md mb-6">
                            Create your first project to start adding buildings,
                            connecting sensors, and setting up monitoring dashboards.
                        </p>
                        <Button
                            variant="primary"
                            onClick={() => setShowCreate(true)}
                        >
                            <Plus className="h-4 w-4 mr-1.5" />
                            Create First Project
                        </Button>
                    </div>
                )}

                {projects.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {projects.map((project) => (
                            <Card
                                key={project.id}
                                variant="default"
                                hover
                                onClick={() => router.push(`/projects/${project.id}`)}
                                className="group"
                            >
                                <div className="flex items-start justify-between mb-3">
                                    <div className="p-2 rounded-lg bg-primary/10">
                                        <FolderOpen className="h-5 w-5 text-primary" />
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setDeleteTarget({ id: project.id, name: project.name }); setDeleteError(null); }}
                                            className="p-1 rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-danger hover:bg-danger/10 transition-all"
                                            title="Delete project"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                        <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                                    </div>
                                </div>
                                <h3 className="text-sm font-semibold text-foreground mb-1 truncate">
                                    {project.name}
                                </h3>
                                {project.description && (
                                    <p className="text-xs text-muted-foreground mb-3 line-clamp-2">
                                        {project.description}
                                    </p>
                                )}
                                <div className="flex items-center gap-3 text-xs text-muted-foreground mt-auto pt-3 border-t border-border/50">
                                    <span className="flex items-center gap-1">
                                        <Building2 className="h-3 w-3" />
                                        {project.siteCount} site{project.siteCount !== 1 ? "s" : ""}
                                    </span>
                                    <span className="flex items-center gap-1">
                                        <Calendar className="h-3 w-3" />
                                        {new Date(project.createdAt).toLocaleDateString()}
                                    </span>
                                </div>
                            </Card>
                        ))}
                    </div>
                )}
            </div>

            {/* Create Project Modal */}
            <Modal
                open={showCreate}
                onClose={() => { setShowCreate(false); setCreateError(null); }}
            >
                <ModalHeader onClose={() => { setShowCreate(false); setCreateError(null); }}>
                    New Project
                </ModalHeader>
                <ModalContent>
                    <div className="space-y-4">
                        {!activeTenant && availableTenants.length > 0 && (
                            <div>
                                <label className="block text-sm font-medium text-foreground mb-1.5">Tenant</label>
                                <select
                                    value={selectedTenantId || availableTenants[0]?.id || ""}
                                    onChange={(e) => setSelectedTenantId(e.target.value)}
                                    className="w-full h-9 px-3 text-sm bg-background border border-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                >
                                    {availableTenants.map((t) => (
                                        <option key={t.id} value={t.id}>{t.name}</option>
                                    ))}
                                </select>
                            </div>
                        )}
                        <Input
                            label="Project Name"
                            placeholder="e.g. Musterstr. Housing Coop"
                            value={createName}
                            onChange={(e) => setCreateName(e.target.value)}
                            error={createError ?? undefined}
                            autoFocus
                            onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
                        />
                        <Input
                            label="Description (optional)"
                            placeholder="e.g. 16 row houses, shared district heating"
                            value={createDesc}
                            onChange={(e) => setCreateDesc(e.target.value)}
                        />
                    </div>
                </ModalContent>
                <ModalFooter>
                    <Button variant="ghost" onClick={() => setShowCreate(false)}>
                        Cancel
                    </Button>
                    <Button
                        variant="primary"
                        onClick={handleCreate}
                        loading={creating}
                        disabled={!createName.trim()}
                    >
                        Create & Open
                    </Button>
                </ModalFooter>
            </Modal>

            {/* Delete Confirmation Modal */}
            <ConfirmModal
                open={!!deleteTarget}
                onClose={() => { setDeleteTarget(null); setDeleteError(null); }}
                onConfirm={handleDeleteConfirm}
                title="Delete Project"
                message={`Are you sure you want to delete "${deleteTarget?.name}"?`}
                detail="This will permanently remove all dashboards and site associations. This action cannot be undone."
                confirmLabel="Delete Project"
                loading={deleting}
                error={deleteError}
            />
        </div>
    );
}
