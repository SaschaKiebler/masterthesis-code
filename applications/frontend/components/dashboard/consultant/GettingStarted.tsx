"use client";

/**
 * GettingStarted — onboarding checklist shown on the consultant dashboard.
 * Tracks progress via completed steps and can be dismissed.
 */

import { useState, useEffect } from "react";
import { X, Check, FolderOpen, Building2, Gauge, LayoutDashboard } from "lucide-react";

const STORAGE_KEY = "kiebler_getting_started_dismissed";

interface GettingStartedProps {
    hasProject: boolean;
    hasBuilding: boolean;
    onCreateProject: () => void;
    onAddBuilding: () => void;
    onAddSensor: () => void;
}

interface Step {
    label: string;
    description: string;
    icon: React.ElementType;
    done: boolean;
    action?: () => void;
    actionLabel?: string;
}

export function GettingStarted({
    hasProject,
    hasBuilding,
    onCreateProject,
    onAddBuilding,
    onAddSensor,
}: GettingStartedProps) {
    const [dismissed, setDismissed] = useState(true); // Start hidden to avoid flash

    useEffect(() => {
        setDismissed(localStorage.getItem(STORAGE_KEY) === "true");
    }, []);

    if (dismissed) return null;

    const steps: Step[] = [
        {
            label: "Create a project",
            description: "A project groups buildings and sensors for one client.",
            icon: FolderOpen,
            done: hasProject,
            action: hasProject ? undefined : onCreateProject,
            actionLabel: "New Project",
        },
        {
            label: "Add a building",
            description: "Set up the building structure with floors and apartments.",
            icon: Building2,
            done: hasBuilding,
            action: hasBuilding ? undefined : (hasProject ? onAddBuilding : undefined),
            actionLabel: "Add Building",
        },
        {
            label: "Add sensors",
            description: "Connect sensors to rooms or buildings to start monitoring.",
            icon: Gauge,
            done: false, // We don't track this granularly
            action: hasProject ? onAddSensor : undefined,
            actionLabel: "Add Sensor",
        },
        {
            label: "Create a dashboard",
            description: "Build a monitoring view with charts and live data.",
            icon: LayoutDashboard,
            done: false,
        },
    ];

    const completedCount = steps.filter(s => s.done).length;

    return (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 md:p-5">
            <div className="flex items-start justify-between mb-3">
                <div>
                    <h3 className="text-sm font-semibold text-foreground">Getting Started</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        {completedCount} of {steps.length} steps completed
                    </p>
                </div>
                <button
                    onClick={() => {
                        localStorage.setItem(STORAGE_KEY, "true");
                        setDismissed(true);
                    }}
                    className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    title="Dismiss"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>

            {/* Progress bar */}
            <div className="h-1.5 bg-muted rounded-full mb-4 overflow-hidden">
                <div
                    className="h-full bg-primary rounded-full transition-all duration-500"
                    style={{ width: `${(completedCount / steps.length) * 100}%` }}
                />
            </div>

            <div className="space-y-2">
                {steps.map((step, i) => {
                    const Icon = step.icon;
                    return (
                        <div
                            key={i}
                            className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                                step.done ? "opacity-60" : "bg-card border border-border"
                            }`}
                        >
                            <div className={`flex items-center justify-center h-6 w-6 rounded-full shrink-0 ${
                                step.done ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                            }`}>
                                {step.done ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className={`text-sm font-medium ${step.done ? "line-through text-muted-foreground" : "text-foreground"}`}>
                                    {step.label}
                                </p>
                                <p className="text-[11px] text-muted-foreground hidden sm:block">{step.description}</p>
                            </div>
                            {step.action && !step.done && (
                                <button
                                    onClick={step.action}
                                    className="shrink-0 px-3 py-1 text-xs font-medium text-primary bg-primary/10 hover:bg-primary/20 rounded-md transition-colors"
                                >
                                    {step.actionLabel}
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
