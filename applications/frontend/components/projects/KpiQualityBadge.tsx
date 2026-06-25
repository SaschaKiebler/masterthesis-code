const QUALITY_STYLES: Record<string, { label: string; classes: string }> = {
    GOOD: { label: "Good", classes: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400" },
    STALE: { label: "Stale", classes: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400" },
    LOW_CONFIDENCE: { label: "Low Conf.", classes: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400" },
    INSUFFICIENT_DATA: { label: "No Data", classes: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400" },
};

export function KpiQualityBadge({ quality }: { quality: string }) {
    const style = QUALITY_STYLES[quality] ?? QUALITY_STYLES.INSUFFICIENT_DATA;
    return (
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${style.classes}`}>
            {style.label}
        </span>
    );
}
