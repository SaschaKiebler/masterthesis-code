/**
 * Header Component
 * Page header with breadcrumbs, title, and subtitle
 */

import { cn } from "@/lib/utils/cn";
import { Breadcrumbs, type BreadcrumbItem } from "./Breadcrumbs";
import type { ReactNode } from "react";

interface HeaderProps {
    title: string;
    subtitle?: string;
    className?: string;
    actions?: ReactNode;
    breadcrumbs?: BreadcrumbItem[];
}

export function Header({ title, subtitle, className, actions, breadcrumbs }: HeaderProps) {
    return (
        <header
            className={cn(
                "border-b border-border bg-card",
                "px-4 py-4 md:px-8 md:py-6",
                className
            )}
        >
            {breadcrumbs && breadcrumbs.length > 0 && (
                <Breadcrumbs items={breadcrumbs} className="mb-2" />
            )}
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-foreground">
                        {title}
                    </h1>
                    {subtitle && (
                        <p className="text-sm md:text-base text-muted-foreground mt-1">
                            {subtitle}
                        </p>
                    )}
                </div>
                {actions && (
                    <div className="flex items-center gap-2 shrink-0">
                        {actions}
                    </div>
                )}
            </div>
        </header>
    );
}
