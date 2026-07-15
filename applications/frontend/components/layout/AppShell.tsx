/**
 * AppShell Component
 * Client wrapper that owns the collapsible-sidebar state and shares it with
 * both the Sidebar and the main content area (which must offset its margin).
 * Collapse preference is persisted to localStorage across sessions.
 */

"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { BottomNav } from "@/components/layout/BottomNav";
import { cn } from "@/lib/utils/cn";

interface SidebarContextValue {
    collapsed: boolean;
    toggle: () => void;
}

const SidebarContext = createContext<SidebarContextValue>({
    collapsed: false,
    toggle: () => {},
});

export function useSidebar() {
    return useContext(SidebarContext);
}

const STORAGE_KEY = "sidebar-collapsed";

export function AppShell({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const [collapsed, setCollapsed] = useState(false);
    // Auth pages (login) render without the app chrome
    const bareLayout = pathname?.startsWith("/auth");

    // Restore persisted preference after mount (avoids SSR hydration mismatch)
    useEffect(() => {
        if (localStorage.getItem(STORAGE_KEY) === "true") {
            setCollapsed(true);
        }
    }, []);

    const toggle = () => {
        setCollapsed((prev) => {
            const next = !prev;
            localStorage.setItem(STORAGE_KEY, String(next));
            return next;
        });
    };

    if (bareLayout) {
        return <>{children}</>;
    }

    return (
        <SidebarContext.Provider value={{ collapsed, toggle }}>
            <div className="flex min-h-screen">
                {/* Desktop Sidebar - hidden on mobile */}
                <Sidebar />

                {/* Main Content - margin tracks the sidebar width */}
                <main
                    className={cn(
                        "flex-1 min-w-0 overflow-x-hidden pb-16 md:pb-0 transition-[margin] duration-300",
                        collapsed ? "md:ml-16" : "md:ml-64"
                    )}
                >
                    {children}
                </main>

                {/* Mobile Bottom Navigation - hidden on desktop */}
                <BottomNav />
            </div>
        </SidebarContext.Provider>
    );
}
