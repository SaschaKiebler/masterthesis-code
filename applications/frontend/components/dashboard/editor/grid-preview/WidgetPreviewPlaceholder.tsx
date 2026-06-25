import { Brain } from "lucide-react";

// ─── Widget preview placeholder ─────────────────────────────────────────────

export function WidgetPreviewPlaceholder({ type }: { type: string }) {
    switch (type) {
        case "time_series":
            return (
                <div className="h-12 flex items-end gap-0.5 px-1">
                    {[40, 60, 35, 70, 55, 80, 45, 65, 50, 75].map((h, i) => (
                        <div
                            key={i}
                            className="flex-1 bg-blue-500/20 rounded-t"
                            style={{ height: `${h}%` }}
                        />
                    ))}
                </div>
            );
        case "gauge":
            return (
                <div className="h-12 flex items-center justify-center">
                    <div className="w-10 h-10 rounded-full border-4 border-amber-500/30 border-t-amber-500 animate-none" />
                </div>
            );
        case "status":
            return (
                <div className="h-12 flex items-center justify-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-emerald-500/40" />
                    <span className="text-xs text-muted-foreground">Online</span>
                </div>
            );
        case "stat_card":
            return (
                <div className="h-12 flex items-center justify-center">
                    <span className="text-2xl font-bold text-muted-foreground/30">42.5</span>
                    <span className="text-xs text-muted-foreground/30 ml-1">°C</span>
                </div>
            );
        case "heating_curve":
            return (
                <div className="h-12 flex items-end px-1">
                    <div className="w-full h-full relative">
                        <div className="absolute bottom-0 left-0 w-full h-[2px] bg-red-500/20 rotate-[-15deg] origin-bottom-left" />
                    </div>
                </div>
            );
        case "derived_property":
            return (
                <div className="h-12 flex items-center justify-center gap-1.5">
                    <Brain className="h-4 w-4 text-violet-500/40" />
                    <span className="text-xl font-bold text-muted-foreground/30">3.45</span>
                </div>
            );
        default:
            return <div className="h-12" />;
    }
}
