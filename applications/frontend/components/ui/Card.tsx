/**
 * Card Component
 * Reusable card container with variants
 */

import { cn } from "@/lib/utils/cn";
import type { ReactNode } from "react";

interface CardProps {
    children: ReactNode;
    className?: string;
    variant?: "default" | "elevated" | "bordered" | "glass";
    padding?: "none" | "sm" | "md" | "lg";
    onClick?: () => void;
    hover?: boolean;
}

export function Card({
    children,
    className,
    variant = "default",
    padding = "md",
    onClick,
    hover = false,
}: CardProps) {
    const baseStyles = "rounded-lg transition-all duration-200";

    const variantStyles = {
        default: "bg-card border border-border",
        elevated: "bg-card shadow-md hover:shadow-lg",
        bordered: "bg-card border-2 border-border",
        glass: "glass",
    };

    const paddingStyles = {
        none: "",
        sm: "p-3",
        md: "p-4",
        lg: "p-6",
    };

    const hoverStyles = hover ? "hover:scale-[1.02] hover:shadow-lg cursor-pointer" : "";
    const clickableStyles = onClick ? "cursor-pointer" : "";

    return (
        <div
            className={cn(
                baseStyles,
                variantStyles[variant],
                paddingStyles[padding],
                hoverStyles,
                clickableStyles,
                className
            )}
            onClick={onClick}
        >
            {children}
        </div>
    );
}

interface CardHeaderProps {
    children: ReactNode;
    className?: string;
}

export function CardHeader({ children, className }: CardHeaderProps) {
    return (
        <div className={cn("mb-4", className)}>
            {children}
        </div>
    );
}

interface CardTitleProps {
    children: ReactNode;
    className?: string;
}

export function CardTitle({ children, className }: CardTitleProps) {
    return (
        <h3 className={cn("text-lg font-semibold text-card-foreground", className)}>
            {children}
        </h3>
    );
}

interface CardContentProps {
    children: ReactNode;
    className?: string;
}

export function CardContent({ children, className }: CardContentProps) {
    return (
        <div className={cn("text-card-foreground", className)}>
            {children}
        </div>
    );
}
