/**
 * Settings Page
 * Account settings and profile information
 * Mobile-first responsive design
 */

"use client";

import { useState } from "react";
import { Header } from "@/components/layout/Header";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/lib/auth/AuthContext";
import { apiFetch } from "@/lib/api/client";
import { User, Shield, Building, LogOut, Pencil, Check, X } from "lucide-react";

const roleColors: Record<string, "primary" | "success" | "warning" | "danger" | "default" | "secondary"> = {
    system_admin: "danger",
    consultant: "primary",
    landlord: "success",
    technician: "warning",
    resident: "secondary",
    viewer: "default",
};

export default function SettingsPage() {
    const { user, globalRole, tenants, refresh } = useAuth();
    const [editingName, setEditingName] = useState(false);
    const [nameValue, setNameValue] = useState(user?.displayName || "");
    const [saving, setSaving] = useState(false);

    const handleSaveName = async () => {
        if (!nameValue.trim()) return;
        setSaving(true);
        try {
            await apiFetch("/me", {
                method: "PATCH",
                body: JSON.stringify({ displayName: nameValue.trim() }),
            });
            refresh();
            setEditingName(false);
        } catch (err: any) {
            alert(err.message || "Failed to update name");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="min-h-screen bg-background">
            <Header
                title="Settings"
                subtitle="Account and profile settings"
                breadcrumbs={[
                    { label: "Dashboard", href: "/" },
                    { label: "Settings" },
                ]}
            />

            <div className="p-4 md:p-8 space-y-6 max-w-2xl">
                {/* Profile Section */}
                <Card variant="bordered">
                    <CardContent>
                        <div className="flex items-center gap-2 mb-4">
                            <User className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                            <h3 className="text-lg font-semibold text-foreground">Profile</h3>
                        </div>

                        <div className="flex items-center gap-4 mb-6">
                            {user?.avatarUrl ? (
                                <img
                                    src={user.avatarUrl}
                                    alt=""
                                    className="h-16 w-16 rounded-full shrink-0"
                                />
                            ) : (
                                <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center shrink-0">
                                    <span className="text-xl font-medium text-muted-foreground">
                                        {(user?.displayName || user?.email || "?")[0].toUpperCase()}
                                    </span>
                                </div>
                            )}
                            <div className="min-w-0">
                                <p className="text-lg font-semibold text-foreground truncate">
                                    {user?.displayName || "—"}
                                </p>
                                <p className="text-sm text-muted-foreground truncate">
                                    {user?.email || "—"}
                                </p>
                            </div>
                        </div>

                        <div className="space-y-3">
                            <div className="flex items-center justify-between py-2 border-b border-border">
                                <span className="text-sm text-muted-foreground">Name</span>
                                {editingName ? (
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="text"
                                            value={nameValue}
                                            onChange={(e) => setNameValue(e.target.value)}
                                            className="px-2 py-1 text-sm rounded border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary w-48"
                                            autoFocus
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter") handleSaveName();
                                                if (e.key === "Escape") setEditingName(false);
                                            }}
                                        />
                                        <button
                                            onClick={handleSaveName}
                                            disabled={saving || !nameValue.trim()}
                                            className="p-1 rounded hover:bg-success/10 text-success transition-colors"
                                            aria-label="Save name"
                                        >
                                            <Check className="h-4 w-4" />
                                        </button>
                                        <button
                                            onClick={() => { setEditingName(false); setNameValue(user?.displayName || ""); }}
                                            className="p-1 rounded hover:bg-muted text-muted-foreground transition-colors"
                                            aria-label="Cancel"
                                        >
                                            <X className="h-4 w-4" />
                                        </button>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm text-foreground">{user?.displayName || "—"}</span>
                                        <button
                                            onClick={() => { setNameValue(user?.displayName || ""); setEditingName(true); }}
                                            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                                            aria-label="Edit name"
                                        >
                                            <Pencil className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                )}
                            </div>
                            <div className="flex items-center justify-between py-2 border-b border-border">
                                <span className="text-sm text-muted-foreground">Email</span>
                                <span className="text-sm text-foreground">{user?.email || "—"}</span>
                            </div>
                            <div className="flex items-center justify-between py-2">
                                <span className="text-sm text-muted-foreground">User ID</span>
                                <span className="text-xs text-muted-foreground font-mono">{user?.id || "—"}</span>
                            </div>
                        </div>

                        <p className="text-xs text-muted-foreground mt-4">
                            Email and avatar are synced from your identity provider. You can change your display name at any time.
                        </p>
                    </CardContent>
                </Card>

                {/* Role Section */}
                <Card variant="bordered">
                    <CardContent>
                        <div className="flex items-center gap-2 mb-4">
                            <Shield className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                            <h3 className="text-lg font-semibold text-foreground">Role &amp; Access</h3>
                        </div>

                        <div className="space-y-3">
                            <div className="flex items-center justify-between py-2 border-b border-border">
                                <span className="text-sm text-muted-foreground">Global Role</span>
                                <Badge variant={roleColors[globalRole] || "default"} size="sm">
                                    {globalRole.replace('_', ' ')}
                                </Badge>
                            </div>
                        </div>

                        {tenants.length > 0 && (
                            <div className="mt-4">
                                <p className="text-sm font-medium text-foreground mb-2">Tenant Memberships</p>
                                <div className="space-y-2">
                                    {tenants.map((t) => (
                                        <div
                                            key={t.id}
                                            className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/50"
                                        >
                                            <div className="flex items-center gap-2 min-w-0">
                                                <Building className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
                                                <span className="text-sm text-foreground truncate">{t.name}</span>
                                            </div>
                                            <Badge variant="secondary" size="sm">{t.tenantRole}</Badge>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {tenants.length === 0 && (
                            <p className="text-sm text-muted-foreground mt-3">
                                You are not a member of any tenants. Contact your administrator for access.
                            </p>
                        )}
                    </CardContent>
                </Card>

                {/* Security Section */}
                <Card variant="bordered">
                    <CardContent>
                        <div className="flex items-center gap-2 mb-4">
                            <Shield className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                            <h3 className="text-lg font-semibold text-foreground">Security</h3>
                        </div>

                        <div className="space-y-3">
                            <div className="py-3 px-3 rounded-lg">
                                <span className="text-sm text-foreground">Change Password</span>
                                <p className="text-xs text-muted-foreground mt-1">
                                    To change your password, sign out and use the &quot;Forgot password&quot; link on the login page.
                                </p>
                            </div>

                            <a
                                href="/auth/logout"
                                className="flex items-center justify-between py-3 px-3 rounded-lg hover:bg-danger/10 transition-colors text-danger"
                            >
                                <span className="text-sm font-medium">Sign Out</span>
                                <LogOut className="h-4 w-4" aria-hidden="true" />
                            </a>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
