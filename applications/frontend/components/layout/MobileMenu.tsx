/**
 * Mobile Menu Component
 * Hamburger menu overlay for mobile devices
 * Slides in from left with backdrop
 */

"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X, Home, Building2, Settings, User } from "lucide-react";
import { cn } from "@/lib/utils/cn";

const navigation = [
    { name: "Dashboard", href: "/", icon: Home },
    { name: "Sites", href: "/sites", icon: Building2 },
    { name: "Settings", href: "/settings", icon: Settings },
];

interface MobileMenuProps {
    isOpen: boolean;
    onClose: () => void;
}

export function MobileMenu({ isOpen, onClose }: MobileMenuProps) {
    return (
        <Fragment>
            {/* Backdrop */}
            {isOpen && (
                <div
                    className="fixed inset-0 bg-black/50 z-40 md:hidden animate-in fade-in duration-200"
                    onClick={onClose}
                    aria-hidden="true"
                />
            )}

            {/* Menu Panel */}
            <aside
                className={cn(
                    "fixed top-0 left-0 h-full w-64 bg-card border-r border-border z-50 md:hidden transition-transform duration-300 ease-in-out",
                    isOpen ? "translate-x-0" : "-translate-x-full"
                )}
                role="dialog"
                aria-label="Mobile menu"
                aria-modal="true"
            >
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-border">
                    <div>
                        <h2 className="text-lg font-bold gradient-text">Kiebler</h2>
                        <p className="text-xs text-muted-foreground mt-0.5">Heizungsoptimierung</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-lg hover:bg-muted transition-colors"
                        aria-label="Close menu"
                    >
                        <X className="h-5 w-5" aria-hidden="true" />
                    </button>
                </div>

                {/* Navigation */}
                <nav className="p-4 space-y-1" role="navigation">
                    {navigation.map((item) => {
                        const pathname = usePathname();
                        const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
                        const Icon = item.icon;

                        return (
                            <Link
                                key={item.name}
                                href={item.href}
                                onClick={onClose}
                                className={cn(
                                    "flex items-center gap-3 px-3 py-3 rounded-lg transition-all duration-200 min-h-[48px]",
                                    isActive
                                        ? "bg-primary text-primary-foreground shadow-md"
                                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                                )}
                                aria-current={isActive ? "page" : undefined}
                            >
                                <Icon className="h-5 w-5" aria-hidden="true" />
                                <span className="font-medium">{item.name}</span>
                            </Link>
                        );
                    })}
                </nav>

                {/* User Section */}
                <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-border">
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                            <User className="h-5 w-5 text-primary" aria-hidden="true" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">Landlord</p>
                            <p className="text-xs text-muted-foreground truncate">Version 0.2.0</p>
                        </div>
                    </div>
                </div>
            </aside>
        </Fragment>
    );
}
