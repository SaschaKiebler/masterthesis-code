/**
 * Team Page
 * Platform user management and invitations for system admins and consultants
 * Role-aware: system_admin sees global Users/Invitations tabs,
 * consultant sees tenant-scoped Members/Invitations tabs.
 */

"use client";

import { Suspense, useState } from "react";
import { Header } from "@/components/layout/Header";
import { Card, CardContent } from "@/components/ui/Card";
import { SiteCardSkeleton } from "@/components/ui/Skeleton";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { InvitationLinkModal } from "@/components/team/InvitationLinkModal";
import { useUsers, updateUserRole } from "@/lib/hooks/useUsers";
import { useInvitations, createInvitation, revokeInvitation } from "@/lib/hooks/useInvitations";
import { useTenants, useTenantMembers, updateTenantMemberRole, removeTenantMember } from "@/lib/hooks/useTenants";
import { useAuth } from "@/lib/auth/AuthContext";
import {
    Users as UsersIcon,
    Mail,
    Plus,
    Search,
    ChevronDown,
    Clock,
    Check,
    X,
    Copy,
    UserMinus,
    Building2,
} from "lucide-react";

type AdminTab = "users" | "invitations";
type ConsultantTab = "members" | "invitations";

const GLOBAL_ROLES = ["system_admin", "consultant", "landlord", "technician", "resident", "viewer"] as const;
const TENANT_ROLES = ["owner", "manager", "member", "viewer"] as const;

const roleColors: Record<string, "primary" | "success" | "warning" | "danger" | "default" | "secondary"> = {
    system_admin: "danger",
    consultant: "primary",
    landlord: "success",
    technician: "warning",
    resident: "secondary",
    viewer: "default",
    owner: "danger",
    manager: "primary",
    member: "success",
};

const statusColors: Record<string, "success" | "warning" | "default"> = {
    pending: "warning",
    accepted: "success",
    expired: "default",
};

export default function TeamPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-background">
                <Header
                    title="Team"
                    subtitle="Manage users and invitations"
                    breadcrumbs={[
                        { label: "Dashboard", href: "/" },
                        { label: "Team" },
                    ]}
                />
                <div className="p-4 md:p-8">
                    <div className="space-y-3">
                        <SiteCardSkeleton />
                        <SiteCardSkeleton />
                        <SiteCardSkeleton />
                    </div>
                </div>
            </div>
        }>
            <TeamContent />
        </Suspense>
    );
}

function TeamContent() {
    const { can, globalRole } = useAuth();
    const isAdmin = globalRole === "system_admin";

    if (isAdmin) {
        return <AdminTeamContent />;
    }

    return <ConsultantTeamContent />;
}

// ── System Admin View ──────────────────────────────────────────────

function AdminTeamContent() {
    const [activeTab, setActiveTab] = useState<AdminTab>("users");
    const [searchQuery, setSearchQuery] = useState("");
    const { can } = useAuth();
    const canManageUsers = can("user:manage");
    const canInvite = can("invitation:manage");

    return (
        <div className="min-h-screen bg-background">
            <Header
                title="Team"
                subtitle="Manage platform users and invitations"
                breadcrumbs={[
                    { label: "Dashboard", href: "/" },
                    { label: "Team" },
                ]}
                actions={
                    canInvite ? (
                        <Button
                            variant="primary"
                            size="sm"
                            onClick={() => setActiveTab("invitations")}
                            aria-label="Invite User"
                        >
                            <Mail className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
                            <span className="hidden sm:inline">Invite User</span>
                        </Button>
                    ) : null
                }
            />

            <div className="p-4 md:p-8">
                {/* Tab Bar */}
                <div className="flex border-b border-border mb-6" role="tablist">
                    <button
                        role="tab"
                        aria-selected={activeTab === "users"}
                        className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                            activeTab === "users"
                                ? "border-primary text-primary"
                                : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}
                        onClick={() => setActiveTab("users")}
                    >
                        <UsersIcon className="h-4 w-4 inline mr-1.5" aria-hidden="true" />
                        Users
                    </button>
                    <button
                        role="tab"
                        aria-selected={activeTab === "invitations"}
                        className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                            activeTab === "invitations"
                                ? "border-primary text-primary"
                                : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}
                        onClick={() => setActiveTab("invitations")}
                    >
                        <Mail className="h-4 w-4 inline mr-1.5" aria-hidden="true" />
                        Invitations
                    </button>
                </div>

                {/* Search */}
                {activeTab === "users" && (
                    <div className="relative mb-4">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search by name or email..."
                            className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-border bg-background text-foreground text-base focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                    </div>
                )}

                {activeTab === "users" ? (
                    <UsersTab searchQuery={searchQuery} canManageUsers={canManageUsers} />
                ) : (
                    <AdminInvitationsTab canInvite={canInvite} />
                )}
            </div>
        </div>
    );
}

// ── Consultant View ────────────────────────────────────────────────

function ConsultantTeamContent() {
    const [activeTab, setActiveTab] = useState<ConsultantTab>("members");
    const { activeTenant, can } = useAuth();
    const canInvite = can("invitation:manage");

    return (
        <div className="min-h-screen bg-background">
            <Header
                title="Team"
                subtitle={activeTenant ? `Manage ${activeTenant.name} members` : "Select a tenant to manage"}
                breadcrumbs={[
                    { label: "Dashboard", href: "/" },
                    { label: "Team" },
                ]}
                actions={
                    canInvite && activeTenant ? (
                        <Button
                            variant="primary"
                            size="sm"
                            onClick={() => setActiveTab("invitations")}
                            aria-label="Invite Member"
                        >
                            <Mail className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
                            <span className="hidden sm:inline">Invite Member</span>
                        </Button>
                    ) : null
                }
            />

            <div className="p-4 md:p-8">
                {/* Tab Bar */}
                <div className="flex border-b border-border mb-6" role="tablist">
                    <button
                        role="tab"
                        aria-selected={activeTab === "members"}
                        className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                            activeTab === "members"
                                ? "border-primary text-primary"
                                : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}
                        onClick={() => setActiveTab("members")}
                    >
                        <UsersIcon className="h-4 w-4 inline mr-1.5" aria-hidden="true" />
                        Members
                    </button>
                    <button
                        role="tab"
                        aria-selected={activeTab === "invitations"}
                        className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                            activeTab === "invitations"
                                ? "border-primary text-primary"
                                : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}
                        onClick={() => setActiveTab("invitations")}
                    >
                        <Mail className="h-4 w-4 inline mr-1.5" aria-hidden="true" />
                        Invitations
                    </button>
                </div>

                {activeTab === "members" ? (
                    <TenantMembersTab />
                ) : (
                    <TenantInvitationsTab />
                )}
            </div>
        </div>
    );
}

// ── Shared: Users Tab (system_admin) ───────────────────────────────

function UsersTab({ searchQuery, canManageUsers }: { searchQuery: string; canManageUsers: boolean }) {
    const { users, page, isLoading, error, mutate } = useUsers({
        search: searchQuery || undefined,
        pageSize: 50,
    });
    const { user: currentUser } = useAuth();
    const [editingRole, setEditingRole] = useState<string | null>(null);
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    const handleRoleChange = async (userId: string, newRole: string) => {
        setActionLoading(userId);
        try {
            await updateUserRole(userId, newRole);
            mutate();
        } catch (err: any) {
            alert(err.message || "Failed to update role");
        } finally {
            setActionLoading(null);
            setEditingRole(null);
        }
    };

    if (isLoading) {
        return (
            <div className="space-y-3">
                <SiteCardSkeleton />
                <SiteCardSkeleton />
                <SiteCardSkeleton />
            </div>
        );
    }

    if (error) {
        return (
            <ErrorMessage
                title="Failed to load users"
                message="Unable to fetch user data."
                onRetry={() => mutate()}
            />
        );
    }

    if (users.length === 0) {
        return (
            <Card variant="bordered">
                <CardContent className="text-center py-8">
                    <UsersIcon className="h-10 w-10 text-muted-foreground mx-auto mb-3" aria-hidden="true" />
                    <p className="text-muted-foreground">
                        {searchQuery ? "No users match your search" : "No users found"}
                    </p>
                </CardContent>
            </Card>
        );
    }

    return (
        <div>
            <p className="text-sm text-muted-foreground mb-3">
                {page?.totalItems ?? users.length} user{(page?.totalItems ?? users.length) !== 1 ? 's' : ''}
            </p>
            <div className="space-y-2">
                {users.map((u) => (
                    <Card key={u.id} variant="bordered" padding="sm">
                        <CardContent>
                            <div className="flex items-center gap-3">
                                {/* Avatar */}
                                {u.avatarUrl ? (
                                    <img src={u.avatarUrl} alt="" className="h-10 w-10 rounded-full shrink-0" />
                                ) : (
                                    <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                                        <span className="text-sm font-medium text-muted-foreground">
                                            {(u.displayName || u.email || "?")[0].toUpperCase()}
                                        </span>
                                    </div>
                                )}

                                {/* Info */}
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-foreground truncate">
                                        {u.displayName || u.email}
                                    </p>
                                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                        <span className="truncate">{u.email}</span>
                                        {u.tenantCount > 0 && (
                                            <span>· {u.tenantCount} tenant{u.tenantCount !== 1 ? 's' : ''}</span>
                                        )}
                                    </div>
                                </div>

                                {/* Role */}
                                <div className="shrink-0">
                                    {canManageUsers && u.id !== currentUser?.id && editingRole === u.id ? (
                                        <select
                                            value={u.globalRole}
                                            onChange={(e) => handleRoleChange(u.id, e.target.value)}
                                            onBlur={() => setEditingRole(null)}
                                            disabled={actionLoading === u.id}
                                            className="text-xs px-2 py-1 rounded border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                                            autoFocus
                                        >
                                            {GLOBAL_ROLES.map((role) => (
                                                <option key={role} value={role}>{role.replace('_', ' ')}</option>
                                            ))}
                                        </select>
                                    ) : (
                                        <button
                                            onClick={() => canManageUsers && u.id !== currentUser?.id && setEditingRole(u.id)}
                                            disabled={!canManageUsers || u.id === currentUser?.id}
                                            className="flex items-center gap-1"
                                        >
                                            <Badge
                                                variant={roleColors[u.globalRole] || "default"}
                                                size="sm"
                                            >
                                                {u.globalRole.replace('_', ' ')}
                                                {canManageUsers && u.id !== currentUser?.id && (
                                                    <ChevronDown className="h-3 w-3 ml-0.5" aria-hidden="true" />
                                                )}
                                            </Badge>
                                        </button>
                                    )}
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>
        </div>
    );
}

// ── Admin Invitations Tab (system_admin — full controls) ───────────

function AdminInvitationsTab({ canInvite }: { canInvite: boolean }) {
    const { invitations, isLoading, error, mutate } = useInvitations();
    const { tenants } = useTenants();
    const [showCreate, setShowCreate] = useState(false);
    const [email, setEmail] = useState("");
    const [tenantId, setTenantId] = useState("");
    const [tenantRole, setTenantRole] = useState("viewer");
    const [globalRole, setGlobalRole] = useState("viewer");
    const [isCreating, setIsCreating] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);
    const [copiedToken, setCopiedToken] = useState<string | null>(null);
    const [createdInvitation, setCreatedInvitation] = useState<{
        token: string;
        email: string;
    } | null>(null);

    const handleCreate = async () => {
        if (!email.trim()) return;
        setIsCreating(true);
        setCreateError(null);
        try {
            const result = await createInvitation({
                email: email.trim(),
                tenantId: tenantId || undefined,
                tenantRole,
                globalRole,
            });
            setCreatedInvitation({
                token: result.invitation.token,
                email: result.invitation.email,
            });
            setEmail("");
            setTenantId("");
            setTenantRole("viewer");
            setGlobalRole("viewer");
            setShowCreate(false);
            mutate();
        } catch (err: any) {
            setCreateError(err.message || "Failed to create invitation");
        } finally {
            setIsCreating(false);
        }
    };

    const handleRevoke = async (id: string) => {
        if (!confirm("Revoke this invitation?")) return;
        try {
            await revokeInvitation(id);
            mutate();
        } catch (err: any) {
            alert(err.message || "Failed to revoke invitation");
        }
    };

    const copyInviteLink = (token: string) => {
        const link = `${window.location.origin}/invite/accept?token=${token}`;
        navigator.clipboard.writeText(link);
        setCopiedToken(token);
        setTimeout(() => setCopiedToken(null), 2000);
    };

    if (isLoading) {
        return (
            <div className="space-y-3">
                <SiteCardSkeleton />
                <SiteCardSkeleton />
            </div>
        );
    }

    if (error) {
        return (
            <ErrorMessage
                title="Failed to load invitations"
                message="Unable to fetch invitation data."
                onRetry={() => mutate()}
            />
        );
    }

    return (
        <div>
            {canInvite && (
                <div className="mb-4">
                    <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}>
                        <Plus className="h-4 w-4 mr-1.5" aria-hidden="true" />
                        Create Invitation
                    </Button>
                </div>
            )}

            {invitations.length === 0 ? (
                <Card variant="bordered">
                    <CardContent className="text-center py-8">
                        <Mail className="h-10 w-10 text-muted-foreground mx-auto mb-3" aria-hidden="true" />
                        <p className="text-muted-foreground">No invitations yet</p>
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-2">
                    {invitations.map((inv) => (
                        <Card key={inv.id} variant="bordered" padding="sm">
                            <CardContent>
                                <div className="flex items-center gap-3">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-foreground truncate">{inv.email}</p>
                                        <div className="flex flex-wrap items-center gap-2 mt-1">
                                            <Badge variant={statusColors[inv.status] || "default"} size="sm">
                                                {inv.status === "pending" && <Clock className="h-3 w-3 mr-1" />}
                                                {inv.status === "accepted" && <Check className="h-3 w-3 mr-1" />}
                                                {inv.status}
                                            </Badge>
                                            <Badge variant={roleColors[inv.globalRole] || "default"} size="sm">
                                                {inv.globalRole.replace('_', ' ')}
                                            </Badge>
                                            {inv.tenantRole !== "viewer" && (
                                                <span className="text-xs text-muted-foreground">
                                                    tenant: {inv.tenantRole}
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-1">
                                            Expires {new Date(inv.expiresAt).toLocaleDateString()}
                                        </p>
                                    </div>

                                    <div className="flex items-center gap-1 shrink-0">
                                        {inv.status === "pending" && (
                                            <>
                                                <button
                                                    onClick={() => copyInviteLink(inv.token)}
                                                    className="p-2 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                                                    aria-label="Copy invite link"
                                                    title="Copy invite link"
                                                >
                                                    {copiedToken === inv.token ? (
                                                        <Check className="h-4 w-4 text-success" />
                                                    ) : (
                                                        <Copy className="h-4 w-4" />
                                                    )}
                                                </button>
                                                {canInvite && (
                                                    <button
                                                        onClick={() => handleRevoke(inv.id)}
                                                        className="p-2 rounded hover:bg-danger/10 text-muted-foreground hover:text-danger transition-colors"
                                                        aria-label="Revoke invitation"
                                                        title="Revoke"
                                                    >
                                                        <X className="h-4 w-4" />
                                                    </button>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            {/* Create Invitation Modal */}
            {showCreate && (
                <div
                    className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Create Invitation"
                >
                    <div
                        className="fixed inset-0 bg-black/50"
                        onClick={() => setShowCreate(false)}
                        aria-hidden="true"
                    />
                    <div className="relative w-full sm:max-w-md bg-card rounded-t-xl sm:rounded-xl p-6 shadow-xl z-10">
                        <h2 className="text-xl font-semibold text-foreground mb-4">Invite User</h2>

                        {createError && (
                            <div className="mb-4 p-3 rounded-lg bg-danger/10 text-danger text-sm">
                                {createError}
                            </div>
                        )}

                        <div className="space-y-4">
                            <div>
                                <label htmlFor="inv-email" className="block text-sm font-medium text-foreground mb-1">
                                    Email
                                </label>
                                <input
                                    id="inv-email"
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="user@example.com"
                                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-base focus:outline-none focus:ring-2 focus:ring-primary"
                                    autoFocus
                                />
                            </div>

                            <div>
                                <label htmlFor="inv-global-role" className="block text-sm font-medium text-foreground mb-1">
                                    Global Role
                                </label>
                                <select
                                    id="inv-global-role"
                                    value={globalRole}
                                    onChange={(e) => setGlobalRole(e.target.value)}
                                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-base focus:outline-none focus:ring-2 focus:ring-primary"
                                >
                                    {GLOBAL_ROLES.map((role) => (
                                        <option key={role} value={role}>{role.replace('_', ' ')}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label htmlFor="inv-tenant" className="block text-sm font-medium text-foreground mb-1">
                                    Tenant (optional)
                                </label>
                                <select
                                    id="inv-tenant"
                                    value={tenantId}
                                    onChange={(e) => setTenantId(e.target.value)}
                                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-base focus:outline-none focus:ring-2 focus:ring-primary"
                                >
                                    <option value="">No tenant</option>
                                    {tenants.map((t) => (
                                        <option key={t.id} value={t.id}>{t.name}</option>
                                    ))}
                                </select>
                            </div>

                            {tenantId && (
                                <div>
                                    <label htmlFor="inv-tenant-role" className="block text-sm font-medium text-foreground mb-1">
                                        Tenant Role
                                    </label>
                                    <select
                                        id="inv-tenant-role"
                                        value={tenantRole}
                                        onChange={(e) => setTenantRole(e.target.value)}
                                        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-base focus:outline-none focus:ring-2 focus:ring-primary"
                                    >
                                        <option value="owner">Owner</option>
                                        <option value="manager">Manager</option>
                                        <option value="member">Member</option>
                                        <option value="viewer">Viewer</option>
                                    </select>
                                </div>
                            )}
                        </div>

                        <div className="flex gap-3 mt-6">
                            <Button variant="ghost" onClick={() => setShowCreate(false)} className="flex-1">
                                Cancel
                            </Button>
                            <Button
                                variant="primary"
                                onClick={handleCreate}
                                loading={isCreating}
                                disabled={!email.trim()}
                                className="flex-1"
                            >
                                Send Invitation
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Invitation Link Modal */}
            {createdInvitation && (
                <InvitationLinkModal
                    token={createdInvitation.token}
                    email={createdInvitation.email}
                    onClose={() => setCreatedInvitation(null)}
                />
            )}
        </div>
    );
}

// ── Tenant Members Tab (consultant view) ───────────────────────────

function TenantMembersTab() {
    const { activeTenant, user: currentUser } = useAuth();
    const { members, isLoading, error, mutate } = useTenantMembers(activeTenant?.id ?? null);
    const [editingRole, setEditingRole] = useState<string | null>(null);
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    const handleRoleChange = async (userId: string, newRole: string) => {
        if (!activeTenant) return;
        setActionLoading(userId);
        try {
            await updateTenantMemberRole(activeTenant.id, userId, newRole);
            mutate();
        } catch (err: any) {
            alert(err.message || "Failed to update role");
        } finally {
            setActionLoading(null);
            setEditingRole(null);
        }
    };

    const handleRemove = async (userId: string, displayName: string | null) => {
        if (!activeTenant) return;
        if (!confirm(`Remove ${displayName || "this member"} from ${activeTenant.name}?`)) return;
        setActionLoading(userId);
        try {
            await removeTenantMember(activeTenant.id, userId);
            mutate();
        } catch (err: any) {
            alert(err.message || "Failed to remove member");
        } finally {
            setActionLoading(null);
        }
    };

    if (!activeTenant) {
        return (
            <Card variant="bordered">
                <CardContent className="text-center py-8">
                    <Building2 className="h-10 w-10 text-muted-foreground mx-auto mb-3" aria-hidden="true" />
                    <p className="text-muted-foreground">Select a tenant to view members</p>
                </CardContent>
            </Card>
        );
    }

    if (isLoading) {
        return (
            <div className="space-y-3">
                <SiteCardSkeleton />
                <SiteCardSkeleton />
                <SiteCardSkeleton />
            </div>
        );
    }

    if (error) {
        return (
            <ErrorMessage
                title="Failed to load members"
                message="Unable to fetch tenant member data."
                onRetry={() => mutate()}
            />
        );
    }

    if (members.length === 0) {
        return (
            <Card variant="bordered">
                <CardContent className="text-center py-8">
                    <UsersIcon className="h-10 w-10 text-muted-foreground mx-auto mb-3" aria-hidden="true" />
                    <p className="text-muted-foreground">No members in this tenant yet</p>
                </CardContent>
            </Card>
        );
    }

    return (
        <div>
            <p className="text-sm text-muted-foreground mb-3">
                {members.length} member{members.length !== 1 ? "s" : ""}
            </p>
            <div className="space-y-2">
                {members.map((m) => (
                    <Card key={m.userId} variant="bordered" padding="sm">
                        <CardContent>
                            <div className="flex items-center gap-3">
                                {/* Avatar */}
                                {m.avatarUrl ? (
                                    <img src={m.avatarUrl} alt="" className="h-10 w-10 rounded-full shrink-0" />
                                ) : (
                                    <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                                        <span className="text-sm font-medium text-muted-foreground">
                                            {(m.displayName || m.email || "?")[0].toUpperCase()}
                                        </span>
                                    </div>
                                )}

                                {/* Info */}
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-foreground truncate">
                                        {m.displayName || m.email}
                                    </p>
                                    <p className="text-xs text-muted-foreground truncate">{m.email}</p>
                                </div>

                                {/* Tenant Role */}
                                <div className="shrink-0 flex items-center gap-1">
                                    {m.userId !== currentUser?.id && editingRole === m.userId ? (
                                        <select
                                            value={m.tenantRole}
                                            onChange={(e) => handleRoleChange(m.userId, e.target.value)}
                                            onBlur={() => setEditingRole(null)}
                                            disabled={actionLoading === m.userId}
                                            className="text-xs px-2 py-1 rounded border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                                            autoFocus
                                        >
                                            {TENANT_ROLES.map((role) => (
                                                <option key={role} value={role}>{role}</option>
                                            ))}
                                        </select>
                                    ) : (
                                        <button
                                            onClick={() => m.userId !== currentUser?.id && setEditingRole(m.userId)}
                                            disabled={m.userId === currentUser?.id}
                                            className="flex items-center gap-1"
                                        >
                                            <Badge
                                                variant={roleColors[m.tenantRole] || "default"}
                                                size="sm"
                                            >
                                                {m.tenantRole}
                                                {m.userId !== currentUser?.id && (
                                                    <ChevronDown className="h-3 w-3 ml-0.5" aria-hidden="true" />
                                                )}
                                            </Badge>
                                        </button>
                                    )}

                                    {m.userId !== currentUser?.id && (
                                        <button
                                            onClick={() => handleRemove(m.userId, m.displayName)}
                                            disabled={actionLoading === m.userId}
                                            className="p-1.5 rounded hover:bg-danger/10 text-muted-foreground hover:text-danger transition-colors"
                                            aria-label="Remove member"
                                            title="Remove member"
                                        >
                                            <UserMinus className="h-4 w-4" />
                                        </button>
                                    )}
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>
        </div>
    );
}

// ── Tenant Invitations Tab (consultant view) ───────────────────────

function TenantInvitationsTab() {
    const { activeTenant, can } = useAuth();
    const canInvite = can("invitation:manage");
    const { invitations, isLoading, error, mutate } = useInvitations(
        activeTenant ? { tenantId: activeTenant.id } : undefined
    );
    const [showCreate, setShowCreate] = useState(false);
    const [email, setEmail] = useState("");
    const [tenantRole, setTenantRole] = useState("viewer");
    const [isCreating, setIsCreating] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);
    const [copiedToken, setCopiedToken] = useState<string | null>(null);
    const [createdInvitation, setCreatedInvitation] = useState<{
        token: string;
        email: string;
    } | null>(null);

    const handleCreate = async () => {
        if (!email.trim() || !activeTenant) return;
        setIsCreating(true);
        setCreateError(null);
        try {
            const result = await createInvitation({
                email: email.trim(),
                tenantId: activeTenant.id,
                tenantRole,
                globalRole: "viewer",
            });
            setCreatedInvitation({
                token: result.invitation.token,
                email: result.invitation.email,
            });
            setEmail("");
            setTenantRole("viewer");
            setShowCreate(false);
            mutate();
        } catch (err: any) {
            setCreateError(err.message || "Failed to create invitation");
        } finally {
            setIsCreating(false);
        }
    };

    const handleRevoke = async (id: string) => {
        if (!confirm("Revoke this invitation?")) return;
        try {
            await revokeInvitation(id);
            mutate();
        } catch (err: any) {
            alert(err.message || "Failed to revoke invitation");
        }
    };

    const copyInviteLink = (token: string) => {
        const link = `${window.location.origin}/invite/accept?token=${token}`;
        navigator.clipboard.writeText(link);
        setCopiedToken(token);
        setTimeout(() => setCopiedToken(null), 2000);
    };

    if (!activeTenant) {
        return (
            <Card variant="bordered">
                <CardContent className="text-center py-8">
                    <Building2 className="h-10 w-10 text-muted-foreground mx-auto mb-3" aria-hidden="true" />
                    <p className="text-muted-foreground">Select a tenant to view invitations</p>
                </CardContent>
            </Card>
        );
    }

    if (isLoading) {
        return (
            <div className="space-y-3">
                <SiteCardSkeleton />
                <SiteCardSkeleton />
            </div>
        );
    }

    if (error) {
        return (
            <ErrorMessage
                title="Failed to load invitations"
                message="Unable to fetch invitation data."
                onRetry={() => mutate()}
            />
        );
    }

    return (
        <div>
            {canInvite && (
                <div className="mb-4">
                    <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}>
                        <Plus className="h-4 w-4 mr-1.5" aria-hidden="true" />
                        Invite Member
                    </Button>
                </div>
            )}

            {invitations.length === 0 ? (
                <Card variant="bordered">
                    <CardContent className="text-center py-8">
                        <Mail className="h-10 w-10 text-muted-foreground mx-auto mb-3" aria-hidden="true" />
                        <p className="text-muted-foreground">No invitations for this tenant</p>
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-2">
                    {invitations.map((inv) => (
                        <Card key={inv.id} variant="bordered" padding="sm">
                            <CardContent>
                                <div className="flex items-center gap-3">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-foreground truncate">{inv.email}</p>
                                        <div className="flex flex-wrap items-center gap-2 mt-1">
                                            <Badge variant={statusColors[inv.status] || "default"} size="sm">
                                                {inv.status === "pending" && <Clock className="h-3 w-3 mr-1" />}
                                                {inv.status === "accepted" && <Check className="h-3 w-3 mr-1" />}
                                                {inv.status}
                                            </Badge>
                                            <Badge variant={roleColors[inv.tenantRole] || "default"} size="sm">
                                                {inv.tenantRole}
                                            </Badge>
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-1">
                                            Expires {new Date(inv.expiresAt).toLocaleDateString()}
                                        </p>
                                    </div>

                                    <div className="flex items-center gap-1 shrink-0">
                                        {inv.status === "pending" && (
                                            <>
                                                <button
                                                    onClick={() => copyInviteLink(inv.token)}
                                                    className="p-2 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                                                    aria-label="Copy invite link"
                                                    title="Copy invite link"
                                                >
                                                    {copiedToken === inv.token ? (
                                                        <Check className="h-4 w-4 text-success" />
                                                    ) : (
                                                        <Copy className="h-4 w-4" />
                                                    )}
                                                </button>
                                                {canInvite && (
                                                    <button
                                                        onClick={() => handleRevoke(inv.id)}
                                                        className="p-2 rounded hover:bg-danger/10 text-muted-foreground hover:text-danger transition-colors"
                                                        aria-label="Revoke invitation"
                                                        title="Revoke"
                                                    >
                                                        <X className="h-4 w-4" />
                                                    </button>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            {/* Simplified invite form for consultant */}
            {showCreate && (
                <div
                    className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Invite Member"
                >
                    <div
                        className="fixed inset-0 bg-black/50"
                        onClick={() => setShowCreate(false)}
                        aria-hidden="true"
                    />
                    <div className="relative w-full sm:max-w-md bg-card rounded-t-xl sm:rounded-xl p-6 shadow-xl z-10">
                        <h2 className="text-xl font-semibold text-foreground mb-4">
                            Invite to {activeTenant.name}
                        </h2>

                        {createError && (
                            <div className="mb-4 p-3 rounded-lg bg-danger/10 text-danger text-sm">
                                {createError}
                            </div>
                        )}

                        <div className="space-y-4">
                            <div>
                                <label htmlFor="inv-email" className="block text-sm font-medium text-foreground mb-1">
                                    Email
                                </label>
                                <input
                                    id="inv-email"
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="user@example.com"
                                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-base focus:outline-none focus:ring-2 focus:ring-primary"
                                    autoFocus
                                />
                            </div>

                            <div>
                                <label htmlFor="inv-tenant-role" className="block text-sm font-medium text-foreground mb-1">
                                    Role
                                </label>
                                <select
                                    id="inv-tenant-role"
                                    value={tenantRole}
                                    onChange={(e) => setTenantRole(e.target.value)}
                                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-base focus:outline-none focus:ring-2 focus:ring-primary"
                                >
                                    <option value="manager">Manager</option>
                                    <option value="member">Member</option>
                                    <option value="viewer">Viewer</option>
                                </select>
                            </div>
                        </div>

                        <div className="flex gap-3 mt-6">
                            <Button variant="ghost" onClick={() => setShowCreate(false)} className="flex-1">
                                Cancel
                            </Button>
                            <Button
                                variant="primary"
                                onClick={handleCreate}
                                loading={isCreating}
                                disabled={!email.trim()}
                                className="flex-1"
                            >
                                Send Invitation
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Invitation Link Modal */}
            {createdInvitation && (
                <InvitationLinkModal
                    token={createdInvitation.token}
                    email={createdInvitation.email}
                    onClose={() => setCreatedInvitation(null)}
                />
            )}
        </div>
    );
}
