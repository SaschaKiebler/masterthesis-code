import type React from "react";

interface ActionBarButtonProps {
    icon: React.ElementType;
    label: string;
    description: string;
    onClick: () => void;
    primary?: boolean;
}

export function ActionBarButton({
    icon: Icon,
    label,
    description,
    onClick,
    primary,
}: ActionBarButtonProps) {
    return (
        <button
            onClick={onClick}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-all text-left ${
                primary
                    ? "border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50"
                    : "border-border hover:border-primary/30 hover:bg-muted/50"
            }`}
        >
            <div className={`p-1.5 rounded-md shrink-0 ${
                primary ? "bg-primary/10" : "bg-muted"
            }`}>
                <Icon className={`h-4 w-4 ${primary ? "text-primary" : "text-muted-foreground"}`} />
            </div>
            <div className="min-w-0">
                <p className={`text-sm font-medium ${primary ? "text-primary" : "text-foreground"}`}>{label}</p>
                <p className="text-[11px] text-muted-foreground leading-tight hidden sm:block">{description}</p>
            </div>
        </button>
    );
}
