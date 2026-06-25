/**
 * Breadcrumbs Component
 * Renders a navigable breadcrumb trail for quick page navigation.
 */

"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface BreadcrumbItem {
    label: string;
    href?: string; // if omitted, rendered as current page (no link)
}

interface BreadcrumbsProps {
    items: BreadcrumbItem[];
    className?: string;
}

export function Breadcrumbs({ items, className }: BreadcrumbsProps) {
    if (items.length === 0) return null;

    return (
        <nav aria-label="Breadcrumb" className={cn("flex items-center", className)}>
            <ol className="flex items-center gap-1 text-sm">
                {items.map((item, index) => {
                    const isLast = index === items.length - 1;

                    return (
                        <li key={index} className="flex items-center gap-1">
                            {index > 0 && (
                                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
                            )}
                            {item.href && !isLast ? (
                                <Link
                                    href={item.href}
                                    className="text-muted-foreground hover:text-foreground transition-colors truncate max-w-[160px]"
                                >
                                    {item.label}
                                </Link>
                            ) : (
                                <span className={cn(
                                    "truncate max-w-[200px]",
                                    isLast
                                        ? "text-foreground font-medium"
                                        : "text-muted-foreground"
                                )}>
                                    {item.label}
                                </span>
                            )}
                        </li>
                    );
                })}
            </ol>
        </nav>
    );
}
