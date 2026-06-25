"use client";

import { useState } from "react";
import { Header } from "@/components/layout/Header";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal, ModalHeader, ModalContent, ModalFooter } from "@/components/ui/Modal";
import { SiteCardSkeleton } from "@/components/ui/Skeleton";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { InvitationLinkModal } from "@/components/team/InvitationLinkModal";
import {
    useTenants,
    createTenantWithInvitation,
    type CreateTenantWithInvitationResponse,
} from "@/lib/hooks/useTenants";
import { Building2, Plus, Calendar } from "lucide-react";

const statusColors: Record<string, "success" | "warning" | "default"> = {
    active: "success",
    suspended: "warning",
    inactive: "default",
};

const typeColors: Record<string, "primary" | "secondary" | "default"> = {
    standard: "default",
    enterprise: "primary",
    trial: "secondary",
};

export default function TenantsPageContent() {
    const { tenants, isLoading, error, mutate } = useTenants();
    const [showCreate, setShowCreate] = useState(false);
    const [createdInvitation, setCreatedInvitation] = useState<{
        token: string;
        email: string;
    } | null>(null);

    // Create form state
    const [tenantName, setTenantName] = useState("");
    const [consultantEmail, setConsultantEmail] = useState("");
    const [consultantTenantRole, setConsultantTenantRole] = useState("manager");
    const [consultantGlobalRole, setConsultantGlobalRole] = useState("consultant");
    const [isCreating, setIsCreating] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);

    const handleCreate = async () => {
        if (!tenantName.trim() || !consultantEmail.trim()) return;
        setIsCreating(true);
        setCreateError(null);
        try {
            const result: CreateTenantWithInvitationResponse = await createTenantWithInvitation({
                name: tenantName.trim(),
                consultantEmail: consultantEmail.trim(),
                consultantTenantRole,
                consultantGlobalRole,
            });
            setTenantName("");
            setConsultantEmail("");
            setConsultantTenantRole("manager");
            setConsultantGlobalRole("consultant");
            setShowCreate(false);
            mutate();
            setCreatedInvitation({
                token: result.invitation.token,
                email: result.invitation.email,
            });
        } catch (err: any) {
            setCreateError(err.message || "Failed to create tenant");
        } finally {
            setIsCreating(false);
        }
    };

    return (
        <div className="min-h-screen bg-background">
            <Header
                title="Tenants"
                subtitle="Manage tenants and onboarding"
                breadcrumbs={[
                    { label: "Dashboard", href: "/" },
                    { label: "Tenants" },
                ]}
                actions={
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={() => setShowCreate(true)}
                        aria-label="Create Tenant"
                    >
                        <Plus className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
                        <span className="hidden sm:inline">Create Tenant</span>
                    </Button>
                }
            />

            <div className="p-4 md:p-8">
                {isLoading ? (
                    <div className="space-y-3">
                        <SiteCardSkeleton />
                        <SiteCardSkeleton />
                        <SiteCardSkeleton />
                    </div>
                ) : error ? (
                    <ErrorMessage
                        title="Failed to load tenants"
                        message="Unable to fetch tenant data."
                        onRetry={() => mutate()}
                    />
                ) : tenants.length === 0 ? (
                    <Card variant="bordered">
                        <CardContent className="text-center py-8">
                            <Building2 className="h-10 w-10 text-muted-foreground mx-auto mb-3" aria-hidden="true" />
                            <p className="text-muted-foreground">No tenants yet</p>
                            <p className="text-sm text-muted-foreground mt-1">
                                Create a tenant to get started with onboarding.
                            </p>
                        </CardContent>
                    </Card>
                ) : (
                    <div>
                        <p className="text-sm text-muted-foreground mb-3">
                            {tenants.length} tenant{tenants.length !== 1 ? "s" : ""}
                        </p>
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {tenants.map((tenant) => (
                                <Card key={tenant.id} variant="bordered" padding="sm">
                                    <CardContent>
                                        <div className="flex items-start gap-3">
                                            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                                                <Building2 className="h-5 w-5 text-primary" aria-hidden="true" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-foreground truncate">
                                                    {tenant.name}
                                                </p>
                                                <div className="flex flex-wrap items-center gap-2 mt-1">
                                                    <Badge
                                                        variant={typeColors[tenant.type] || "default"}
                                                        size="sm"
                                                    >
                                                        {tenant.type}
                                                    </Badge>
                                                    <Badge
                                                        variant={statusColors[tenant.status] || "default"}
                                                        size="sm"
                                                    >
                                                        {tenant.status}
                                                    </Badge>
                                                </div>
                                                {tenant.createdAt && (
                                                    <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
                                                        <Calendar className="h-3 w-3" aria-hidden="true" />
                                                        {new Date(tenant.createdAt).toLocaleDateString()}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Create Tenant Modal */}
            <Modal open={showCreate} onClose={() => setShowCreate(false)}>
                <ModalHeader onClose={() => setShowCreate(false)}>
                    Create Tenant
                </ModalHeader>
                <ModalContent>
                    {createError && (
                        <div className="mb-4 p-3 rounded-lg bg-danger/10 text-danger text-sm">
                            {createError}
                        </div>
                    )}
                    <div className="space-y-4">
                        <Input
                            label="Tenant Name"
                            value={tenantName}
                            onChange={(e) => setTenantName(e.target.value)}
                            placeholder="Hausverwaltung Mueller"
                            required
                        />
                        <Input
                            label="Consultant Email"
                            type="email"
                            value={consultantEmail}
                            onChange={(e) => setConsultantEmail(e.target.value)}
                            placeholder="mueller@example.com"
                            helperText="An invitation will be sent to this email."
                            required
                        />
                        <div className="space-y-1.5">
                            <label htmlFor="tenant-role" className="block text-sm font-medium text-foreground">
                                Tenant Role
                            </label>
                            <select
                                id="tenant-role"
                                value={consultantTenantRole}
                                onChange={(e) => setConsultantTenantRole(e.target.value)}
                                className="block w-full rounded-lg border border-input bg-card px-3 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
                            >
                                <option value="manager">Manager</option>
                                <option value="owner">Owner</option>
                                <option value="member">Member</option>
                                <option value="viewer">Viewer</option>
                            </select>
                        </div>
                        <div className="space-y-1.5">
                            <label htmlFor="global-role" className="block text-sm font-medium text-foreground">
                                Global Role
                            </label>
                            <select
                                id="global-role"
                                value={consultantGlobalRole}
                                onChange={(e) => setConsultantGlobalRole(e.target.value)}
                                className="block w-full rounded-lg border border-input bg-card px-3 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
                            >
                                <option value="consultant">Consultant</option>
                                <option value="landlord">Landlord</option>
                                <option value="viewer">Viewer</option>
                            </select>
                        </div>
                    </div>
                </ModalContent>
                <ModalFooter>
                    <Button variant="ghost" onClick={() => setShowCreate(false)}>
                        Cancel
                    </Button>
                    <Button
                        variant="primary"
                        onClick={handleCreate}
                        loading={isCreating}
                        disabled={!tenantName.trim() || !consultantEmail.trim()}
                    >
                        Create & Invite
                    </Button>
                </ModalFooter>
            </Modal>

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
