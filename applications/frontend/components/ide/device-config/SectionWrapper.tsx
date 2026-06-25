import { cn } from "@/lib/utils/cn";
import { Radio } from "lucide-react";

interface SectionWrapperProps {
    title: string;
    badge?: string;
    badgeColor?: string;
    children: React.ReactNode;
}

export function SectionWrapper({
    title,
    badge,
    badgeColor,
    children,
}: SectionWrapperProps) {
    return (
        <div className="px-4 py-3 border-b border-border/50">
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5">
                        <Radio className="h-3 w-3 text-amber-500" />
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            {title}
                        </p>
                    </div>
                    {badge && (
                        <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", badgeColor)}>
                            {badge}
                        </span>
                    )}
                </div>
            </div>
            {children}
        </div>
    );
}
