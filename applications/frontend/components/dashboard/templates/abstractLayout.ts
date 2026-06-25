/**
 * abstractLayout — converts a concrete dashboard layout (with specific assetId/metricPointId)
 * into an abstract template layout (with objectTypeName/metricMatch patterns).
 *
 * This allows the template to be applied to a different project that has the same
 * types of devices, even though the specific object IDs are different.
 */

import type { DashboardLayout, DashboardWidget, WidgetConfig, GraphObject } from "@/lib/api/types";
import type { MetricPoint } from "@/lib/api/metric-points";

interface AbstractionContext {
    objects: GraphObject[];
    /** Map of objectId → MetricPoint[] (pre-fetched for all devices used in widgets) */
    metricsByObject: Map<string, MetricPoint[]>;
}

export interface AbstractWidgetConfig extends Omit<WidgetConfig, "assetId" | "metricPointId"> {
    /** Object type name to match against (e.g. "ENERGY_METER") */
    _bindObjectType?: string;
    /** Metric display name pattern to match (e.g. "total_active_power") */
    _bindMetricName?: string;
    /** For time_series: abstracted series bindings */
    _bindSeries?: Array<{
        _bindObjectType?: string;
        _bindMetricName?: string;
        color?: string;
        label?: string;
    }>;
}

/**
 * Convert a concrete layout to an abstract template layout.
 * Replaces specific object/metric IDs with type+name patterns.
 */
export function abstractLayout(
    layout: DashboardLayout,
    ctx: AbstractionContext
): DashboardLayout {
    return {
        columns: layout.columns,
        widgets: layout.widgets.map(w => abstractWidget(w, ctx)),
    };
}

function abstractWidget(widget: DashboardWidget, ctx: AbstractionContext): DashboardWidget {
    const config = abstractConfig(widget.config, ctx);
    return {
        ...widget,
        id: crypto.randomUUID(), // new ID for template
        config,
    };
}

function abstractConfig(config: WidgetConfig, ctx: AbstractionContext): AbstractWidgetConfig {
    const result: AbstractWidgetConfig = { ...config };

    // Remove concrete IDs
    delete (result as any).assetId;
    delete (result as any).metricPointId;
    delete (result as any).metricId;

    // Resolve object type from assetId
    if (config.assetId) {
        const obj = ctx.objects.find(o => o.id === config.assetId);
        if (obj) {
            result._bindObjectType = obj.objectTypeName;
        }
    }

    // Resolve metric name from metricPointId
    if (config.metricPointId && config.assetId) {
        const metrics = ctx.metricsByObject.get(config.assetId);
        const mp = metrics?.find(m => m.id === config.metricPointId);
        if (mp) {
            result._bindMetricName = mp.displayName ?? mp.quantityName ?? undefined;
        }
    } else if (config.metric) {
        // Legacy: metric is already a name string
        result._bindMetricName = config.metric;
    }

    // Handle time_series with multiple series
    if (config.series && Array.isArray(config.series)) {
        result._bindSeries = config.series.map(s => {
            const entry: NonNullable<AbstractWidgetConfig["_bindSeries"]>[number] = {
                color: s.color,
                label: s.label,
            };

            // Resolve object type
            const seriesAssetId = s.assetId || config.assetId;
            if (seriesAssetId) {
                const obj = ctx.objects.find(o => o.id === seriesAssetId);
                if (obj) entry._bindObjectType = obj.objectTypeName;
            }

            // Resolve metric name
            if (s.metricPointId && seriesAssetId) {
                const metrics = ctx.metricsByObject.get(seriesAssetId);
                const mp = metrics?.find(m => m.id === s.metricPointId);
                if (mp) entry._bindMetricName = mp.displayName ?? mp.quantityName ?? undefined;
            } else if (s.metric) {
                entry._bindMetricName = s.metric;
            }

            return entry;
        });
        // Remove concrete series
        delete (result as any).series;
    }

    return result;
}
