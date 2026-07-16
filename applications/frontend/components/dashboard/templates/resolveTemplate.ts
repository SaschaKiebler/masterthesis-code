/**
 * resolveTemplate — takes an abstract template layout and resolves it against
 * the actual devices and metrics in the current project.
 *
 * For each widget, finds matching objects by objectTypeName and matching
 * metrics by displayName/quantityName pattern.
 */

import { randomUUID } from "@/lib/utils/uuid";
import type { DashboardLayout, DashboardWidget, WidgetConfig, GraphObject } from "@/lib/api/types";
import type { MetricPoint } from "@/lib/api/metric-points";
import type { AbstractWidgetConfig } from "./abstractLayout";

interface ResolutionContext {
    objects: GraphObject[];
    /** Map of objectId → MetricPoint[] (pre-fetched for all devices in project) */
    metricsByObject: Map<string, MetricPoint[]>;
}

export interface ResolutionResult {
    layout: DashboardLayout;
    /** Number of widgets that were fully resolved (have valid data sources) */
    boundCount: number;
    /** Number of widgets that couldn't find matching device/metric */
    unboundCount: number;
}

/**
 * Resolve an abstract template layout to concrete widget configs.
 */
export function resolveTemplate(
    templateLayout: DashboardLayout,
    ctx: ResolutionContext
): ResolutionResult {
    let boundCount = 0;
    let unboundCount = 0;

    // Track which objects have been used for each type to distribute across devices
    const usedByType = new Map<string, number>();

    const widgets = templateLayout.widgets.map((w): DashboardWidget => {
        const config = w.config as AbstractWidgetConfig;
        const resolved = resolveConfig(config, ctx, usedByType);

        if (resolved._bound) {
            boundCount++;
        } else if (config._bindObjectType) {
            unboundCount++;
        } else {
            // Widget doesn't need binding (event_timeline, etc.)
            boundCount++;
        }

        // Clean up internal binding fields
        const { _bindObjectType, _bindMetricName, _bindSeries, _bound, ...cleanConfig } = resolved;

        return {
            ...w,
            id: randomUUID(),
            config: cleanConfig,
        };
    });

    return {
        layout: { columns: templateLayout.columns, widgets },
        boundCount,
        unboundCount,
    };
}

interface ResolvedConfig extends AbstractWidgetConfig {
    _bound?: boolean;
    assetId?: string;
    metricPointId?: string;
    metricId?: number;
    metric?: string;
}

function resolveConfig(
    config: AbstractWidgetConfig,
    ctx: ResolutionContext,
    usedByType: Map<string, number>
): ResolvedConfig {
    const result: ResolvedConfig = { ...config };

    // Resolve object binding
    if (config._bindObjectType) {
        const candidates = ctx.objects.filter(o => o.objectTypeName === config._bindObjectType);

        if (candidates.length > 0) {
            // Pick the next unused object of this type (round-robin)
            const idx = usedByType.get(config._bindObjectType) ?? 0;
            const obj = candidates[idx % candidates.length];
            usedByType.set(config._bindObjectType, idx + 1);

            result.assetId = obj.id;

            // Resolve metric binding
            if (config._bindMetricName) {
                const metrics = ctx.metricsByObject.get(obj.id) ?? [];
                const mp = findMatchingMetric(metrics, config._bindMetricName);
                if (mp) {
                    result.metricPointId = mp.id;
                    result.metricId = mp.metricId;
                    result.metric = mp.displayName;
                    result._bound = true;
                } else {
                    // Metric not found — set metric name as fallback
                    result.metric = config._bindMetricName;
                    result._bound = true; // still partially bound
                }
            } else {
                result._bound = true;
            }
        }
    } else {
        // No binding needed (event_timeline, etc.)
        result._bound = true;
    }

    // Resolve time_series bindings
    if (config._bindSeries && Array.isArray(config._bindSeries)) {
        result.series = config._bindSeries.map(s => {
            const entry: any = { color: s.color, label: s.label };

            if (s._bindObjectType) {
                const candidates = ctx.objects.filter(o => o.objectTypeName === s._bindObjectType);
                if (candidates.length > 0) {
                    const idx = usedByType.get(s._bindObjectType + ":series") ?? 0;
                    const obj = candidates[idx % candidates.length];
                    usedByType.set(s._bindObjectType + ":series", idx + 1);
                    entry.assetId = obj.id;

                    if (s._bindMetricName) {
                        const metrics = ctx.metricsByObject.get(obj.id) ?? [];
                        const mp = findMatchingMetric(metrics, s._bindMetricName);
                        if (mp) {
                            entry.metricPointId = mp.id;
                            entry.metricId = mp.metricId;
                            entry.metric = mp.displayName;
                        } else {
                            entry.metric = s._bindMetricName;
                        }
                    }
                }
            }

            return entry;
        });
        result._bound = true;
    }

    return result;
}

/**
 * Find a metric point matching a name pattern.
 * Tries exact match on displayName, then quantityName, then partial match.
 */
function findMatchingMetric(metrics: MetricPoint[], pattern: string): MetricPoint | undefined {
    const lower = pattern.toLowerCase();

    // Exact match on displayName
    const exact = metrics.find(m => m.displayName?.toLowerCase() === lower);
    if (exact) return exact;

    // Exact match on quantityName
    const byQuantity = metrics.find(m => m.quantityName?.toLowerCase() === lower);
    if (byQuantity) return byQuantity;

    // Partial match (metric name contains pattern or vice versa)
    const partial = metrics.find(m =>
        m.displayName?.toLowerCase().includes(lower)
        || lower.includes(m.displayName?.toLowerCase() ?? "")
    );
    return partial;
}
