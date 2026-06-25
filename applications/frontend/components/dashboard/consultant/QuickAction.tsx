"use client";

import type { LucideIcon } from "lucide-react";

export function QuickAction({
    icon: Icon,
    label,
    onClick,
}: {
    icon: LucideIcon;
    label: string;
    onClick: () => void;
}) {
    return (
        <button
            onClick={onClick}
            className="flex flex-col items-center gap-2 p-4 rounded-lg border border-border bg-card hover:bg-muted hover:border-primary/30 transition-all duration-200 cursor-pointer group"
        >
            <div className="p-2 rounded-lg bg-muted group-hover:bg-primary/10 transition-colors">
                <Icon className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
            <span className="text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors">
                {label}
            </span>
        </button>
    );
}
