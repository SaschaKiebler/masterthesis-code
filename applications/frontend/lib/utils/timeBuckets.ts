/**
 * Shared time-range presets and bucket-size utilities for dashboards.
 * Extracted from app/assets/[id]/page.tsx to be reusable across widgets.
 */

/** Preset time spans in seconds. */
export const TIME_PRESET_SECONDS: Record<string, number> = {
    "1h": 3600,
    "3h": 3 * 3600,
    "6h": 6 * 3600,
    "12h": 12 * 3600,
    "24h": 24 * 3600,
    "3d": 3 * 86400,
    "7d": 7 * 86400,
    "30d": 30 * 86400,
};

/** Known-good bucket sizes per preset (minutes). */
const PRESET_BUCKETS: Record<string, number> = {
    "1h": 1,
    "3h": 1,
    "6h": 5,
    "12h": 15,
    "24h": 60,
    "3d": 60,
    "7d": 360,
    "30d": 1440,
};

/** Auto-calculate bucket minutes from a time span in seconds. */
export function autoBucketMinutes(spanSeconds: number): number {
    const h = spanSeconds / 3600;
    if (h <= 3) return 1;
    if (h <= 6) return 5;
    if (h <= 24) return 15;
    if (h <= 72) return 60;
    return 360;
}

/** Recommended bucket minutes for a named preset. */
export function bucketForPreset(preset: string): number {
    return PRESET_BUCKETS[preset] ?? autoBucketMinutes(TIME_PRESET_SECONDS[preset] ?? 86400);
}
