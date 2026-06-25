/**
 * Signal Map Utilities
 * Parse, serialize, and manage signal map entries for asset telemetry configuration.
 */

export interface SignalEntry {
    metricId: string;
    name: string;
    unit: string;
    min: string;
    max: string;
    source: string;
    field: string;
}

export interface SecretsField {
    key: string;
    title: string;
    description?: string;
    pattern?: string;
    required: boolean;
}

export const COMMON_UNITS = [
    "celsius", "fahrenheit", "kelvin",
    "percent", "hPa", "bar", "psi",
    "kWh", "Wh", "W", "kW",
    "m3/h", "m3", "l/min", "l/h", "l",
    "V", "A", "Hz",
    "ppm", "dB", "lux",
] as const;

/**
 * Parse a signal map JSON string into a list of editable entries.
 */
export function parseSignalMap(json?: string): SignalEntry[] {
    if (!json || json === "{}") return [];
    try {
        const parsed = JSON.parse(json);
        return Object.entries(parsed).map(([metricId, def]: [string, any]) => ({
            metricId,
            name: def.name || "",
            unit: def.unit || "",
            min: def.min !== undefined ? String(def.min) : "",
            max: def.max !== undefined ? String(def.max) : "",
            source: def.source || "",
            field: def.field || "",
        }));
    } catch {
        return [];
    }
}

/**
 * Serialize a list of signal entries back to a JSON string.
 */
export function signalEntriesToJson(entries: SignalEntry[]): string {
    const map: Record<string, any> = {};
    for (const entry of entries) {
        if (!entry.metricId || !entry.name) continue;
        const def: Record<string, any> = { name: entry.name };
        if (entry.unit) def.unit = entry.unit;
        if (entry.min !== "") def.min = parseFloat(entry.min);
        if (entry.max !== "") def.max = parseFloat(entry.max);
        if (entry.source) def.source = entry.source;
        if (entry.field) def.field = entry.field;
        map[entry.metricId] = def;
    }
    return JSON.stringify(map);
}

/**
 * Parse a JSON Schema `secretsSchema` into a list of form fields.
 */
export function parseSecretsFields(schema?: string): SecretsField[] {
    if (!schema || schema === "{}") return [];
    try {
        const parsed = JSON.parse(schema);
        const properties = parsed.properties || {};
        const required = new Set<string>(parsed.required || []);
        return Object.entries(properties).map(([key, def]: [string, any]) => ({
            key,
            title: def.title || key,
            description: def.description,
            pattern: def.pattern,
            required: required.has(key),
        }));
    } catch {
        return [];
    }
}

/**
 * Parse an AI-generated signal map into editable entries.
 * AI format uses MQTT topic paths as keys (e.g. "switch:0/apower")
 * and "signalName" instead of "name". Splits key at first "/" into source + field.
 * Accepts either a JSON string or a pre-parsed object.
 */
export function parseAiSignalMap(input?: string | Record<string, any>): SignalEntry[] {
    if (!input) return [];
    let parsed: any;
    try {
        parsed = typeof input === "string" ? JSON.parse(input) : input;
        // AI models sometimes return already-stringified JSON, causing double-encoding.
        // Unwrap until we get an actual object.
        while (typeof parsed === "string") {
            parsed = JSON.parse(parsed);
        }
    } catch {
        return [];
    }
    if (!parsed || typeof parsed !== "object") return [];

    return Object.entries(parsed).map(([topicKey, def]: [string, any], idx) => {
        const slashIdx = topicKey.indexOf("/");
        const source = slashIdx > 0 ? topicKey.slice(0, slashIdx) : topicKey;
        const field = slashIdx > 0 ? topicKey.slice(slashIdx + 1) : "";
        // AI models use inconsistent field names — try all common variants,
        // falling back to the topic key (e.g. "switch:0/apower" → "apower")
        const name =
            def?.signalName || def?.name || def?.label || def?.description ||
            field || topicKey;
        return {
            metricId: String(idx + 1),
            name,
            unit: def?.unit || "",
            min: def?.min !== undefined ? String(def.min) : "",
            max: def?.max !== undefined ? String(def.max) : "",
            source,
            field,
        };
    });
}

/**
 * Compute the next auto-incremented metric ID for a new signal entry.
 */
export function nextMetricId(entries: SignalEntry[]): string {
    if (entries.length === 0) return "1";
    return String(Math.max(...entries.map((e) => parseInt(e.metricId) || 0)) + 1);
}

/**
 * Common MQTT source components for autocomplete suggestions.
 */
export const COMMON_SOURCES = [
    "temperature:0", "temperature:1", "temperature:2", "temperature:3",
    "humidity:0",
    "devicepower:0",
    "switch:0", "switch:1",
    "em:0", "emdata:0",
] as const;
