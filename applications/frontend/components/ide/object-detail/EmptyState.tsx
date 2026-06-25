import { Building2, MousePointerClick, Gauge, Plus } from "lucide-react";

// ─── Empty state ──────────────────────────────────────────────────────────────

export interface EmptyStateProps {
    objectCount: number;
    linkCount: number;
    onSetupBuilding?: () => void;
    onAddSensor?: () => void;
}

export function EmptyState({ objectCount, linkCount, onSetupBuilding, onAddSensor }: EmptyStateProps) {
    return (
        <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <div className="p-3 rounded-full bg-muted/50 mb-3">
                {objectCount === 0 ? (
                    <Building2 className="h-6 w-6 text-muted-foreground" />
                ) : (
                    <MousePointerClick className="h-6 w-6 text-muted-foreground" />
                )}
            </div>
            <p className="text-sm text-muted-foreground">
                {objectCount === 0
                    ? "Your project is empty. Start by setting up a building."
                    : "Select a building, sensor, or connection to see its details and configuration."
                }
            </p>
            <p className="text-xs text-muted-foreground/60 mt-2 mb-4">
                {objectCount} item{objectCount !== 1 ? "s" : ""} · {linkCount} connection{linkCount !== 1 ? "s" : ""}
            </p>

            {/* Quick action buttons */}
            {(onSetupBuilding || onAddSensor) && (
                <div className="flex flex-col gap-2 w-full max-w-[200px]">
                    {onSetupBuilding && objectCount === 0 && (
                        <button
                            onClick={onSetupBuilding}
                            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                        >
                            <Building2 className="h-4 w-4" />
                            Set Up Building
                        </button>
                    )}
                    {onAddSensor && (
                        <button
                            onClick={onAddSensor}
                            className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        >
                            <Gauge className="h-4 w-4" />
                            Add Sensor
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
