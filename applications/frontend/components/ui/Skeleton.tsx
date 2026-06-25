/**
 * Skeleton Component
 * Loading placeholder with pulse animation
 * Preferred over spinners for better perceived performance
 */

import { cn } from "@/lib/utils/cn";

interface SkeletonProps {
    className?: string;
    variant?: "text" | "card" | "circle" | "custom";
}

export function Skeleton({ className, variant = "custom" }: SkeletonProps) {
    return (
        <div
            className={cn(
                "animate-pulse bg-muted rounded",
                variant === "text" && "h-4 w-full",
                variant === "card" && "h-32 w-full",
                variant === "circle" && "h-12 w-12 rounded-full",
                className
            )}
            role="status"
            aria-label="Loading"
        >
            <span className="sr-only">Loading...</span>
        </div>
    );
}

/**
 * Stats Card Skeleton
 * Skeleton for dashboard stats cards
 */
export function StatsCardSkeleton() {
    return (
        <div className="bg-card rounded-lg border border-border p-6">
            <div className="flex items-center justify-between mb-4">
                <Skeleton variant="circle" className="h-10 w-10" />
                <Skeleton variant="text" className="h-4 w-16" />
            </div>
            <Skeleton variant="text" className="h-8 w-20 mb-2" />
            <Skeleton variant="text" className="h-3 w-24" />
        </div>
    );
}

/**
 * Site Card Skeleton
 * Skeleton for site cards in grid view
 */
export function SiteCardSkeleton() {
    return (
        <div className="bg-card rounded-lg border border-border p-6">
            <div className="flex items-start justify-between mb-4">
                <Skeleton variant="circle" className="h-12 w-12" />
                <Skeleton variant="text" className="h-5 w-16" />
            </div>
            <Skeleton variant="text" className="h-6 w-3/4 mb-2" />
            <Skeleton variant="text" className="h-4 w-full mb-3" />
            <div className="flex items-center justify-between pt-3 border-t border-border">
                <Skeleton variant="text" className="h-4 w-16" />
                <Skeleton variant="text" className="h-6 w-12" />
            </div>
        </div>
    );
}

/**
 * List Item Skeleton
 * Skeleton for list items
 */
export function ListItemSkeleton() {
    return (
        <div className="p-3 rounded-lg">
            <div className="flex items-center justify-between">
                <div className="flex-1">
                    <Skeleton variant="text" className="h-5 w-32 mb-1" />
                    <Skeleton variant="text" className="h-4 w-24" />
                </div>
                <Skeleton variant="text" className="h-5 w-16" />
            </div>
        </div>
    );
}
