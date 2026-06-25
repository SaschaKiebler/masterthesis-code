/**
 * Consultant Dashboard
 * Rich welcome page for consultants and system admins.
 * Shows greeting, portfolio stats, recent projects with quick-resume links,
 * quick actions, and an onboarding state for new users.
 */

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/Header";
import { StatsCard } from "@/components/charts/StatsCard";
import { Button } from "@/components/ui/Button";
import { StatsCardSkeleton } from "@/components/ui/Skeleton";
import { useAuth } from "@/lib/auth/AuthContext";
import { useProjects } from "@/lib/hooks/useProjects";
import { useTenants } from "@/lib/hooks/useTenants";
import {
    FolderOpen,
    Users,
    Plus,
    Building2,
    Gauge,
    Monitor,
    ArrowRight,
} from "lucide-react";
import { getGreeting, formatDate } from "@/components/dashboard/consultant/helpers";
import { RecentProjectCard } from "@/components/dashboard/consultant/RecentProjectCard";
import { QuickAction } from "@/components/dashboard/consultant/QuickAction";
import { CreateProjectModal } from "@/components/dashboard/consultant/CreateProjectModal";
import { ProjectPickerModal } from "@/components/dashboard/consultant/ProjectPickerModal";
import { EmptyState } from "@/components/dashboard/consultant/EmptyState";
import { GettingStarted } from "@/components/dashboard/consultant/GettingStarted";

export function ConsultantDashboard() {
    const router = useRouter();
    const { user, tenants: memberTenants, activeTenant, isLoading: authLoading, globalRole } = useAuth();
    const { projects, loading: projectsLoading, create } = useProjects();
    const { tenants: allTenants } = useTenants();

    // Create project modal state
    const [showCreate, setShowCreate] = useState(false);
    // Project picker for quick actions (add building / add sensor)
    const [pickerAction, setPickerAction] = useState<"add-building" | "add-sensor" | null>(null);
    const [createName, setCreateName] = useState("");
    const [createDesc, setCreateDesc] = useState("");
    const [selectedTenantId, setSelectedTenantId] = useState("");
    const [creating, setCreating] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);

    const isAdmin = globalRole === "system_admin" || globalRole === "consultant";
    const availableTenants = isAdmin && memberTenants.length === 0
        ? allTenants.map((t) => ({ id: t.id, name: t.name }))
        : memberTenants.map((t) => ({ id: t.id, name: t.name }));
    const effectiveTenantId = activeTenant?.id ?? (selectedTenantId || availableTenants[0]?.id);

    const isLoading = authLoading || projectsLoading;

    // Derived stats
    const totalProjects = projects.length;
    const totalObjects = projects.reduce((sum, p) => sum + p.siteCount, 0);
    const totalTenants = memberTenants.length || allTenants.length;
    const activeProjects = projects.filter((p) => p.status === "active").length;

    // 4 most recently updated projects
    const recentProjects = [...projects]
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, 4);

    const displayName = user?.displayName?.split(" ")[0] || "there";
    const greeting = getGreeting();

    const subtitle = activeTenant
        ? `Managing ${activeTenant.name}`
        : `${formatDate()}`;

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

    const createModalProps = {
        open: showCreate,
        onClose: () => { setShowCreate(false); setCreateError(null); },
        activeTenant,
        availableTenants,
        selectedTenantId,
        setSelectedTenantId,
        createName,
        setCreateName,
        createDesc,
        setCreateDesc,
        creating,
        createError,
        onSubmit: handleCreate,
    };

    // ─── Loading State ─────────────────────────────────────────────────────────
    if (isLoading) {
        return (
            <div className="min-h-screen bg-background">
                <Header title="Dashboard" subtitle="Loading..." />
                <div className="p-4 md:p-8 space-y-6 md:space-y-8">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
                        <StatsCardSkeleton />
                        <StatsCardSkeleton />
                        <StatsCardSkeleton />
                        <StatsCardSkeleton />
                    </div>
                </div>
            </div>
        );
    }

    // ─── Empty State (no projects) ─────────────────────────────────────────────
    if (totalProjects === 0) {
        return (
            <div className="min-h-screen bg-background">
                <Header title={`${greeting}, ${displayName}`} subtitle={subtitle} />
                <EmptyState
                    greeting={greeting}
                    displayName={displayName}
                    subtitle={subtitle}
                    onCreateProject={() => setShowCreate(true)}
                    onBrowseTemplates={() => router.push("/templates")}
                />
                <CreateProjectModal {...createModalProps} />
            </div>
        );
    }

    // ─── Main Dashboard ────────────────────────────────────────────────────────
    return (
        <div className="min-h-screen bg-background">
            <Header
                title={`${greeting}, ${displayName}`}
                subtitle={subtitle}
                actions={
                    <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}>
                        <Plus className="h-4 w-4 mr-1.5" />
                        New Project
                    </Button>
                }
            />

            <div className="p-4 md:p-8 space-y-6 md:space-y-8">
                {/* Stats Grid */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
                    <StatsCard title="Projects" value={totalProjects} icon={FolderOpen} />
                    <StatsCard title="Buildings" value={totalObjects} icon={Building2} />
                    <StatsCard title="Active" value={activeProjects} icon={Monitor} />
                    <StatsCard title="Tenants" value={totalTenants} icon={Users} />
                </div>

                {/* Getting Started Checklist */}
                <GettingStarted
                    hasProject={totalProjects > 0}
                    hasBuilding={totalObjects > 0}
                    onCreateProject={() => setShowCreate(true)}
                    onAddBuilding={() => {
                        if (projects.length === 1) {
                            router.push(`/projects/${projects[0].id}/ide?action=add-building`);
                        } else {
                            setPickerAction("add-building");
                        }
                    }}
                    onAddSensor={() => {
                        if (projects.length === 1) {
                            router.push(`/projects/${projects[0].id}/ide?action=add-sensor`);
                        } else {
                            setPickerAction("add-sensor");
                        }
                    }}
                />

                {/* Recent Projects */}
                <section>
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-semibold text-foreground">Recent Projects</h2>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => router.push("/projects")}
                        >
                            View All
                            <ArrowRight className="h-4 w-4 ml-1" />
                        </Button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        {recentProjects.map((project) => (
                            <RecentProjectCard
                                key={project.id}
                                project={project}
                                onNavigate={(path) => router.push(path)}
                            />
                        ))}
                    </div>
                </section>

                {/* Quick Actions */}
                <section>
                    <h2 className="text-lg font-semibold text-foreground mb-4">Quick Actions</h2>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <QuickAction
                            icon={Plus}
                            label="New Project"
                            onClick={() => setShowCreate(true)}
                        />
                        <QuickAction
                            icon={Building2}
                            label="Add Building"
                            onClick={() => {
                                if (projects.length === 1) {
                                    router.push(`/projects/${projects[0].id}/ide?action=add-building`);
                                } else {
                                    setPickerAction("add-building");
                                }
                            }}
                        />
                        <QuickAction
                            icon={Gauge}
                            label="Add Sensor"
                            onClick={() => {
                                if (projects.length === 1) {
                                    router.push(`/projects/${projects[0].id}/ide?action=add-sensor`);
                                } else {
                                    setPickerAction("add-sensor");
                                }
                            }}
                        />
                        <QuickAction
                            icon={FolderOpen}
                            label="All Projects"
                            onClick={() => router.push("/projects")}
                        />
                    </div>
                </section>
            </div>

            {/* Create Project Modal */}
            <CreateProjectModal {...createModalProps} />

            {/* Project Picker for quick actions */}
            <ProjectPickerModal
                open={pickerAction !== null}
                onClose={() => setPickerAction(null)}
                title={pickerAction === "add-building" ? "Add Building" : "Add Sensor"}
                projects={projects}
                onSelect={(projectId) => {
                    router.push(`/projects/${projectId}/ide?action=${pickerAction}`);
                }}
            />
        </div>
    );
}
