/**
 * Sidebar Navigation Component
 * Main navigation for tablet and desktop
 * Hidden on mobile (< 768px) - replaced by bottom nav
 * Role-aware: navigation items filtered by user permissions (ADR-009)
 * Collapsible to an icons-only rail (state owned by AppShell)
 */

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
    Home,
    Settings,
    Users,
    FolderOpen,
    Building2,
    ScanLine,
    BookOpen,
    PanelLeftClose,
    PanelLeftOpen,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useAuth } from "@/lib/auth/AuthContext";
import { UserProfile } from "@/components/auth/UserProfile";
import { TenantSwitcher } from "@/components/auth/TenantSwitcher";
import { useSidebar } from "@/components/layout/AppShell";
import type { Permission } from "@/lib/auth/types";

interface NavItem {
    name: string;
    href: string;
    icon: React.ComponentType<{ className?: string }>;
    permission?: Permission;
}

const allNavItems: NavItem[] = [
    { name: "Dashboard", href: "/", icon: Home },
    { name: "Projects", href: "/projects", icon: FolderOpen, permission: "fleet:view" },
    { name: "Device Catalog", href: "/templates", icon: BookOpen, permission: "template:create" },
    { name: "Device Scanner", href: "/discovery", icon: ScanLine, permission: "template:create" },
    { name: "Tenants", href: "/tenants", icon: Building2, permission: "user:manage" },
    { name: "Team", href: "/team", icon: Users, permission: "team:manage" },
    { name: "Settings", href: "/settings", icon: Settings },
];

export function Sidebar() {
    const pathname = usePathname();
    const { can, isAuthenticated } = useAuth();
    const { collapsed, toggle } = useSidebar();

    // Filter navigation by permissions
    const navigation = allNavItems.filter(
        (item) => !item.permission || can(item.permission)
    );

    return (
        <aside
            className={cn(
                "hidden md:flex fixed left-0 top-0 h-screen bg-card border-r border-border flex-col transition-[width] duration-300",
                collapsed ? "w-16" : "w-64"
            )}
            role="navigation"
            aria-label="Main navigation"
        >
            {/* Logo/Branding + collapse toggle */}
            <div
                className={cn(
                    "flex items-center border-b border-border h-[73px] shrink-0",
                    collapsed ? "justify-center px-2" : "justify-between px-6"
                )}
            >
                {!collapsed && (
                    <div className="min-w-0">
                        <h1 className="text-xl font-bold gradient-text truncate">Kiebler</h1>
                        <p className="text-xs text-muted-foreground mt-1 truncate">
                            Heizungsoptimierung
                        </p>
                    </div>
                )}
                <button
                    type="button"
                    onClick={toggle}
                    className="p-2 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
                    aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                    aria-expanded={!collapsed}
                    title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                >
                    {collapsed ? (
                        <PanelLeftOpen className="h-5 w-5" aria-hidden="true" />
                    ) : (
                        <PanelLeftClose className="h-5 w-5" aria-hidden="true" />
                    )}
                </button>
            </div>

            {/* Tenant Switcher (consultant/admin only) - hidden when collapsed */}
            {isAuthenticated && !collapsed && (
                <div className="px-4 pt-4">
                    <TenantSwitcher />
                </div>
            )}

            {/* Navigation */}
            <nav className={cn("flex-1 space-y-1 py-4", collapsed ? "px-2" : "px-4")}>
                {navigation.map((item) => {
                    const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
                    const Icon = item.icon;

                    return (
                        <Link
                            key={item.name}
                            href={item.href}
                            className={cn(
                                "flex items-center rounded-lg transition-all duration-200",
                                collapsed ? "justify-center px-2 py-2" : "gap-3 px-3 py-2",
                                isActive
                                    ? "bg-primary text-primary-foreground shadow-md"
                                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                            )}
                            aria-current={isActive ? "page" : undefined}
                            title={collapsed ? item.name : undefined}
                        >
                            <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                            {!collapsed && <span className="font-medium">{item.name}</span>}
                        </Link>
                    );
                })}
            </nav>

            {/* User Profile & Footer */}
            <div
                className={cn(
                    "border-t border-border space-y-3 shrink-0",
                    collapsed ? "p-2" : "p-4"
                )}
            >
                <UserProfile collapsed={collapsed} />
                {!collapsed && (
                    <p className="text-xs text-muted-foreground">Version 0.3.0</p>
                )}
            </div>
        </aside>
    );
}
