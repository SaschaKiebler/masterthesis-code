/**
 * Analytics Service API client — calls the Python analytics-service
 * via the Next.js /api/analytics/* proxy.
 */

const ANALYTICS_BASE = "/api/analytics";

async function analyticsFetch<T>(endpoint: string, body: unknown): Promise<T> {
    const response = await fetch(`${ANALYTICS_BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        throw new Error(`Analytics API error: ${response.status} ${response.statusText}`);
    }
    return response.json();
}

// ─── Request/Response Types ─────────────────────────────────────────────────

export interface TimeRange {
    start: number;
    end: number;
}

export interface MetricStats {
    metric_point_id: string;
    device_id: string;
    metric_id: number;
    display_name: string | null;
    unit: string | null;
    count: number;
    mean: number;
    median: number;
    std: number;
    min: number;
    max: number;
    q25: number;
    q75: number;
    iqr: number;
}

export interface DescriptiveResponse {
    metrics: MetricStats[];
    meta: { computation_time_ms: number; data_points_processed: number };
}

export interface TimeseriesPoint {
    time: number;
    value: number | null;
}

export interface TimeseriesSeries {
    metric_point_id: string;
    display_name: string | null;
    unit: string | null;
    values: TimeseriesPoint[];
    rolling_values: TimeseriesPoint[] | null;
}

export interface TimeseriesResponse {
    series: TimeseriesSeries[];
    bucket_seconds: number;
    meta: { computation_time_ms: number; data_points_processed: number };
}

export interface DifferenceResponse {
    difference: { label: string; values: TimeseriesPoint[] };
    meta: { computation_time_ms: number; data_points_processed: number };
}

// ─── API Functions ──────────────────────────────────────────────────────────

export async function fetchDescriptiveStats(
    metricPointIds: string[],
    timeRange: TimeRange,
): Promise<DescriptiveResponse> {
    return analyticsFetch<DescriptiveResponse>("/stats/descriptive", {
        metric_point_ids: metricPointIds,
        time_range: timeRange,
    });
}

export async function fetchTimeseries(
    metricPointIds: string[],
    timeRange: TimeRange,
    options?: {
        resample?: string;
        aggregation?: string;
        rolling_window?: string;
    },
): Promise<TimeseriesResponse> {
    return analyticsFetch<TimeseriesResponse>("/stats/timeseries", {
        metric_point_ids: metricPointIds,
        time_range: timeRange,
        ...options,
    });
}

export async function fetchDifference(
    metricPointIdA: string,
    metricPointIdB: string,
    timeRange: TimeRange,
    resample?: string,
): Promise<DifferenceResponse> {
    return analyticsFetch<DifferenceResponse>("/stats/difference", {
        metric_point_id_a: metricPointIdA,
        metric_point_id_b: metricPointIdB,
        time_range: timeRange,
        resample: resample || "auto",
    });
}
