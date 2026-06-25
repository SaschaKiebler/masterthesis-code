import { format, formatDistanceToNow } from "date-fns";

/**
 * Format a temperature value with unit
 */
export function formatTemperature(value: number, unit: string = "celsius"): string {
    const symbol = unit === "celsius" ? "°C" : unit === "fahrenheit" ? "°F" : "K";
    return `${value.toFixed(1)}${symbol}`;
}

/**
 * Format a generic measurement value with unit
 */
export function formatMeasurement(value: number, unit: string): string {
    return `${value.toFixed(2)} ${unit}`;
}

/**
 * Format a timestamp to a readable date string
 */
export function formatDate(timestamp: number | Date, formatString: string = "PPp"): string {
    const date = typeof timestamp === "number" ? new Date(timestamp * 1000) : timestamp;
    return format(date, formatString);
}

/**
 * Format a timestamp to a relative time string (e.g., "2 hours ago")
 */
export function formatRelativeTime(timestamp: number | Date): string {
    const date = typeof timestamp === "number" ? new Date(timestamp * 1000) : timestamp;
    return formatDistanceToNow(date, { addSuffix: true });
}

/**
 * Parse a JSONB address and return a human-readable string.
 * Handles: {"display": "..."}, {"street": "...", "city": "..."}, plain strings, or "{}".
 */
export function formatAddress(address?: string): string | null {
    if (!address || address === "{}" || address === "null") return null;

    try {
        const parsed = JSON.parse(address);
        if (typeof parsed === "string") return parsed;
        if (parsed.display) return parsed.display;
        // Structured address: combine street + city + zip etc.
        const parts = [parsed.street, parsed.zip, parsed.city, parsed.country].filter(Boolean);
        return parts.length > 0 ? parts.join(", ") : null;
    } catch {
        // Not valid JSON — treat as plain text
        return address;
    }
}

/**
 * Format a number with thousand separators
 */
export function formatNumber(value: number): string {
    return new Intl.NumberFormat("en-US").format(value);
}
