import {
    LineChart, Gauge, Activity, BarChart3, Flame, Brain, Bell, GitBranch, List,
} from "lucide-react";

// ─── Widget type metadata ───────────────────────────────────────────────────

export const WIDGET_META: Record<string, { icon: React.ElementType; label: string; color: string }> = {
    time_series:      { icon: LineChart, label: "Time Series",    color: "text-blue-500" },
    gauge:            { icon: Gauge,     label: "Gauge",          color: "text-amber-500" },
    status:           { icon: Activity,  label: "Status",         color: "text-emerald-500" },
    stat_card:        { icon: BarChart3, label: "Stat Card",      color: "text-purple-500" },
    derived_property: { icon: Brain,     label: "Computed KPI",   color: "text-violet-500" },
    event_timeline:   { icon: Bell,      label: "Timeline",       color: "text-cyan-500" },
    comparison:       { icon: GitBranch, label: "Comparison",     color: "text-orange-500" },
    event_log:        { icon: List,      label: "Event Log",      color: "text-teal-500" },
};
