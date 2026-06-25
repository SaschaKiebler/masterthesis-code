"use client";

import { Modal, ModalHeader, ModalContent } from "@/components/ui/Modal";
import { cn } from "@/lib/utils/cn";
import type { WidgetType } from "./useEditorState";
import {
    LineChart, Gauge, Activity, BarChart3, Flame, Brain, Bell, GitBranch, List,
} from "lucide-react";

const WIDGET_OPTIONS: {
    type: WidgetType;
    icon: React.ElementType;
    label: string;
    description: string;
    color: string;
}[] = [
    { type: "time_series",      icon: LineChart,  label: "Time Series",    description: "Line chart over time",     color: "text-blue-500 bg-blue-500/10" },
    { type: "gauge",            icon: Gauge,      label: "Gauge",          description: "Circular progress meter",  color: "text-amber-500 bg-amber-500/10" },
    { type: "status",           icon: Activity,   label: "Status",         description: "Online/offline indicator", color: "text-emerald-500 bg-emerald-500/10" },
    { type: "stat_card",        icon: BarChart3,  label: "Stat Card",      description: "Single numeric value",     color: "text-purple-500 bg-purple-500/10" },
    { type: "derived_property", icon: Brain,      label: "Computed KPI",   description: "Derived metric value",     color: "text-violet-500 bg-violet-500/10" },
    { type: "event_timeline",   icon: Bell,       label: "Event Timeline", description: "Chronological events",     color: "text-cyan-500 bg-cyan-500/10" },
    { type: "comparison",       icon: GitBranch,  label: "Comparison",     description: "Side-by-side metrics",     color: "text-orange-500 bg-orange-500/10" },
    { type: "event_log",        icon: List,       label: "Event Log",      description: "Boolean state change log", color: "text-teal-500 bg-teal-500/10" },
];

interface AddWidgetModalProps {
    open: boolean;
    onClose: () => void;
    onSelect: (type: WidgetType) => void;
}

export function AddWidgetModal({ open, onClose, onSelect }: AddWidgetModalProps) {
    return (
        <Modal open={open} onClose={onClose} className="md:max-w-md">
            <ModalHeader onClose={onClose}>Add Widget</ModalHeader>
            <ModalContent>
                <div className="grid grid-cols-2 gap-3">
                    {WIDGET_OPTIONS.map(({ type, icon: Icon, label, description, color }) => (
                        <button
                            key={type}
                            onClick={() => { onSelect(type); onClose(); }}
                            className={cn(
                                "flex flex-col items-start gap-2 p-3 rounded-lg border border-border",
                                "text-left transition-all",
                                "hover:border-primary/40 hover:shadow-sm hover:bg-muted/50",
                                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            )}
                        >
                            <div className={cn("p-1.5 rounded-md", color)}>
                                <Icon className="h-4 w-4" />
                            </div>
                            <div>
                                <div className="text-sm font-medium text-foreground">{label}</div>
                                <div className="text-xs text-muted-foreground">{description}</div>
                            </div>
                        </button>
                    ))}
                </div>
            </ModalContent>
        </Modal>
    );
}
