import type { WidgetConfig } from "@/lib/api/types";

/**
 * Apply a frontend-only linear transform to a raw measurement value.
 * Formula: result = (raw * multiply) + offset, rounded to `decimals` places.
 * Returns the original value unchanged if no transform is configured.
 */
export function applyValueTransform(
    raw: number,
    transform: WidgetConfig["valueTransform"],
): number {
    if (!transform) return raw;
    const mul = transform.multiply ?? 1;
    const off = transform.offset ?? 0;
    const dec = transform.decimals ?? 1;
    const result = raw * mul + off;
    const factor = Math.pow(10, dec);
    return Math.round(result * factor) / factor;
}

/**
 * Returns the display unit: transform override unit > yAxis unit > fallback.
 */
export function getTransformedUnit(config: WidgetConfig): string | undefined {
    return config.valueTransform?.unit || config.yAxis?.unit;
}
