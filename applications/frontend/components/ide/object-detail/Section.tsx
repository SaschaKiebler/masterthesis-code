// ─── Reusable section & info row primitives ──────────────────────────────────

import { InfoTooltip } from "@/components/ui/InfoTooltip";

export function Section({
    title,
    tooltip,
    count,
    action,
    children,
}: {
    title: string;
    tooltip?: string;
    count?: number;
    action?: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <div className="px-4 py-3 border-b border-border/50">
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{title}</p>
                    {tooltip && <InfoTooltip text={tooltip} />}
                    {count !== undefined && (
                        <span className="text-[10px] text-muted-foreground/60 tabular-nums">{count}</span>
                    )}
                </div>
                {action}
            </div>
            {children}
        </div>
    );
}

export function InfoRow({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
    return (
        <div className="flex items-center justify-between py-0.5">
            <span className="text-xs text-muted-foreground">{label}</span>
            {children ?? <span className="text-xs text-foreground font-medium">{value}</span>}
        </div>
    );
}
