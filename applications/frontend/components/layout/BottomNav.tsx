/**
 * Bottom Navigation Component
 * Mobile-only navigation bar (< 768px)
 * Sticky bottom navigation with touch-optimized targets
 * Role-aware: items filtered by user permissions (ADR-009)
 *
 * Pattern: 3 primary items + "More" button.
 * "More" opens a bottom sheet with all remaining nav items + user profile.
 * If the active page is behind "More", the button shows the active indicator.
 */

"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
    Home, Settings, MoreHorizontal,
    Users, BookOpen, Building2,
    LogOut, LogIn, User, X,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useAuth } from "@/lib/auth/AuthContext";
import type { Permission } from "@/lib/auth/types";

interface MobileNavItem {
    name: string;
    href: string;
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    permission?: Permission;
}

// All nav items — same order as sidebar, with mobile labels
const allNavItems: MobileNavItem[] = [
    { name: "Dashboard", href: "/", icon: Home, label: "Home" },
    { name: "Device Catalog", href: "/templates", icon: BookOpen, label: "Devices", permission: "template:create" },
    { name: "Tenants", href: "/tenants", icon: Building2, label: "Tenants", permission: "user:manage" },
    { name: "Team", href: "/team", icon: Users, label: "Team", permission: "team:manage" },
    { name: "Settings", href: "/settings", icon: Settings, label: "Settings" },
];

// Maximum primary slots in the bottom bar (excluding the "More" button)
const PRIMARY_SLOT_COUNT = 3;

export function BottomNav() {
    const pathname = usePathname();
    const { can } = useAuth();
    const [moreOpen, setMoreOpen] = useState(false);

    // Close sheet on route change
    useEffect(() => {
        setMoreOpen(false);
    }, [pathname]);

    // Permission-filtered items
    const visibleItems = useMemo(
        () => allNavItems.filter((item) => !item.permission || can(item.permission)),
        [can]
    );

    // Split into primary (shown in bar) and overflow (shown in sheet)
    const primaryItems = visibleItems.slice(0, PRIMARY_SLOT_COUNT);
    const overflowItems = visibleItems.slice(PRIMARY_SLOT_COUNT);
    const hasOverflow = overflowItems.length > 0;

    // "More" is active if the current path matches any overflow item
    const moreIsActive = overflowItems.some(
        (item) => pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href))
    );

    return (
        <>
            {/* Bottom sheet overlay + content */}
            {hasOverflow && (
                <MoreSheet
                    open={moreOpen}
                    onClose={() => setMoreOpen(false)}
                    items={overflowItems}
                    pathname={pathname}
                />
            )}

            {/* Bottom bar */}
            <nav
                className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border md:hidden"
                role="navigation"
                aria-label="Mobile navigation"
            >
                <div className="flex items-center justify-around h-16 px-2 safe-bottom">
                    {primaryItems.map((item) => {
                        const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
                        return (
                            <NavButton
                                key={item.name}
                                item={item}
                                isActive={isActive}
                            />
                        );
                    })}

                    {/* "More" button */}
                    {hasOverflow && (
                        <button
                            onClick={() => setMoreOpen((v) => !v)}
                            className={cn(
                                "flex flex-col items-center justify-center gap-1 px-3 py-2 rounded-lg transition-all duration-200 min-w-[64px] min-h-[48px]",
                                moreOpen || moreIsActive
                                    ? "text-primary"
                                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                            )}
                            aria-label={moreOpen ? "Close menu" : "More navigation items"}
                            aria-expanded={moreOpen}
                            aria-haspopup="dialog"
                        >
                            {moreOpen ? (
                                <X className="h-6 w-6 scale-110" aria-hidden="true" />
                            ) : (
                                <MoreHorizontal className={cn("h-6 w-6", moreIsActive && "scale-110")} aria-hidden="true" />
                            )}
                            <span className={cn("text-xs font-medium", (moreOpen || moreIsActive) && "font-semibold")}>
                                {moreOpen ? "Close" : "More"}
                            </span>
                        </button>
                    )}
                </div>
            </nav>
        </>
    );
}

// --- Primary nav button ---

function NavButton({ item, isActive }: { item: MobileNavItem; isActive: boolean }) {
    const Icon = item.icon;
    return (
        <Link
            href={item.href}
            className={cn(
                "flex flex-col items-center justify-center gap-1 px-3 py-2 rounded-lg transition-all duration-200 min-w-[64px] min-h-[48px]",
                isActive
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
            aria-label={item.label}
            aria-current={isActive ? "page" : undefined}
        >
            <Icon className={cn("h-6 w-6", isActive && "scale-110")} aria-hidden="true" />
            <span className={cn("text-xs font-medium", isActive && "font-semibold")}>
                {item.label}
            </span>
        </Link>
    );
}

// --- "More" bottom sheet ---

function MoreSheet({
    open,
    onClose,
    items,
    pathname,
}: {
    open: boolean;
    onClose: () => void;
    items: MobileNavItem[];
    pathname: string;
}) {
    const sheetRef = useRef<HTMLDivElement>(null);
    const { user, isAuthenticated, isLoading } = useAuth();

    // Close on Escape
    const handleKeyDown = useCallback(
        (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        },
        [onClose]
    );

    useEffect(() => {
        if (open) {
            document.addEventListener("keydown", handleKeyDown);
            // Prevent body scroll while sheet is open
            document.body.style.overflow = "hidden";
        }
        return () => {
            document.removeEventListener("keydown", handleKeyDown);
            document.body.style.overflow = "";
        };
    }, [open, handleKeyDown]);

    if (!open) return null;

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 z-40 bg-black/40 md:hidden animate-backdrop"
                onClick={onClose}
                aria-hidden="true"
            />

            {/* Sheet — sits above backdrop, below bottom bar */}
            <div
                ref={sheetRef}
                role="dialog"
                aria-modal="true"
                aria-label="More navigation"
                className="fixed left-0 right-0 bottom-16 z-40 md:hidden animate-sheet-up"
            >
                <div className="mx-3 mb-2 bg-card rounded-2xl border border-border shadow-xl overflow-hidden">
                    {/* Drag handle */}
                    <div className="flex justify-center pt-3 pb-1" aria-hidden="true">
                        <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
                    </div>

                    {/* Nav grid */}
                    <div className="grid grid-cols-4 gap-1 px-3 pb-3">
                        {items.map((item) => {
                            const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
                            const Icon = item.icon;
                            return (
                                <Link
                                    key={item.name}
                                    href={item.href}
                                    className={cn(
                                        "flex flex-col items-center justify-center gap-1.5 py-3 px-2 rounded-xl transition-all duration-200 min-h-[64px]",
                                        isActive
                                            ? "bg-primary/10 text-primary"
                                            : "text-muted-foreground hover:text-foreground hover:bg-muted"
                                    )}
                                    aria-label={item.label}
                                    aria-current={isActive ? "page" : undefined}
                                >
                                    <Icon className={cn("h-5 w-5", isActive && "scale-110")} aria-hidden="true" />
                                    <span className={cn("text-[11px] font-medium leading-tight text-center", isActive && "font-semibold")}>
                                        {item.label}
                                    </span>
                                </Link>
                            );
                        })}
                    </div>

                    {/* Divider + User section */}
                    <div className="border-t border-border px-4 py-3">
                        {isLoading ? (
                            <div className="flex items-center gap-3">
                                <div className="h-8 w-8 rounded-full bg-muted animate-pulse shrink-0" />
                                <div className="flex-1 space-y-1.5">
                                    <div className="h-3 w-24 bg-muted rounded animate-pulse" />
                                    <div className="h-2.5 w-32 bg-muted rounded animate-pulse" />
                                </div>
                            </div>
                        ) : isAuthenticated && user ? (
                            <div className="flex items-center gap-3">
                                {/* Avatar + info */}
                                <Link
                                    href="/settings"
                                    className="flex items-center gap-3 flex-1 min-w-0 rounded-lg p-1 -m-1 hover:bg-muted transition-colors"
                                    aria-label="Account settings"
                                >
                                    {user.avatarUrl ? (
                                        <img
                                            src={user.avatarUrl}
                                            alt=""
                                            className="h-8 w-8 rounded-full shrink-0 ring-2 ring-border"
                                        />
                                    ) : (
                                        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                            <User className="h-4 w-4 text-primary" aria-hidden="true" />
                                        </div>
                                    )}
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-foreground truncate">
                                            {user.displayName || user.email}
                                        </p>
                                        <p className="text-xs text-muted-foreground truncate">
                                            {user.email}
                                        </p>
                                    </div>
                                </Link>
                                {/* Logout */}
                                <a
                                    href="/auth/logout"
                                    className="p-2 rounded-lg text-muted-foreground hover:text-danger hover:bg-danger/10 transition-colors shrink-0"
                                    aria-label="Sign out"
                                >
                                    <LogOut className="h-5 w-5" aria-hidden="true" />
                                </a>
                            </div>
                        ) : (
                            <a
                                href="/auth/login"
                                className="flex items-center gap-3 px-2 py-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                                aria-label="Sign in"
                            >
                                <LogIn className="h-5 w-5" aria-hidden="true" />
                                <span className="text-sm font-medium">Sign In</span>
                            </a>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}
