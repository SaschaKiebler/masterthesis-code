/**
 * Badge Component
 * Status indicators and labels
 */

import { cn } from "@/lib/utils/cn";
import type { ReactNode } from "react";

interface BadgeProps {
    children: ReactNode;
    variant?: "default" | "primary" | "success" | "warning" | "danger" | "secondary";
    size?: "sm" | "md" | "lg";
    className?: string;
}

export function Badge({
    children,
    variant = "default",
    size = "md",
    className,
}: BadgeProps) {
    const baseStyles = "inline-flex items-center justify-center font-medium rounded-full transition-colors";

    const variantStyles = {
        default: "bg-muted text-muted-foreground",
        primary: "bg-primary text-primary-foreground",
        success: "bg-success text-success-foreground",
        warning: "bg-warning text-warning-foreground",
        danger: "bg-danger text-danger-foreground",
        secondary: "bg-secondary text-secondary-foreground",
    };

    const sizeStyles = {
        sm: "px-2 py-0.5 text-xs",
        md: "px-2.5 py-1 text-sm",
        lg: "px-3 py-1.5 text-base",
    };

    return (
        <span className={cn(baseStyles, variantStyles[variant], sizeStyles[size], className)}>
            {children}
        </span>
    );
}
