"use client";

/**
 * SetupBuildingWizard — multi-step wizard to create a building with floors and apartments.
 * Steps: Building Name → Floors → Apartments per floor → Review & Create
 */

import { useState, useCallback } from "react";
import { WizardShell, type WizardStep } from "./WizardShell";
import { Input } from "@/components/ui/Input";
import { createObject } from "@/lib/api/graph";
import { createLink } from "@/lib/api/graph";
import { Building2, Layers, Home } from "lucide-react";

const STEPS: WizardStep[] = [
    { label: "Building" },
    { label: "Floors" },
    { label: "Apartments" },
    { label: "Review" },
];

interface SetupBuildingWizardProps {
    open: boolean;
    onClose: () => void;
    tenantId: string;
    projectId: string;
    onComplete: () => void;
}

export function SetupBuildingWizard({
    open,
    onClose,
    tenantId,
    projectId,
    onComplete,
}: SetupBuildingWizardProps) {
    const [step, setStep] = useState(0);
    const [buildingName, setBuildingName] = useState("");
    const [floorCount, setFloorCount] = useState(1);
    const [apartmentsPerFloor, setApartmentsPerFloor] = useState(0);
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const reset = useCallback(() => {
        setStep(0);
        setBuildingName("");
        setFloorCount(1);
        setApartmentsPerFloor(0);
        setError(null);
    }, []);

    const handleClose = useCallback(() => {
        reset();
        onClose();
    }, [reset, onClose]);

    const totalItems = 1 + floorCount + (floorCount * apartmentsPerFloor);

    const handleCreate = useCallback(async () => {
        setCreating(true);
        setError(null);
        try {
            // 1. Create building
            const buildingRes = await createObject({
                objectTypeName: "BUILDING",
                displayName: buildingName.trim(),
                tenantId,
                projectId,
            });
            const buildingId = buildingRes.object.id;

            // 2. Create floors + link to building
            for (let f = 1; f <= floorCount; f++) {
                const floorRes = await createObject({
                    objectTypeName: "FLOOR",
                    displayName: `Floor ${f}`,
                    tenantId,
                    projectId,
                });
                const floorId = floorRes.object.id;
                await createLink({
                    sourceId: buildingId,
                    targetId: floorId,
                    linkTypeName: "CONTAINS",
                });

                // 3. Create apartments per floor + link to floor
                for (let a = 1; a <= apartmentsPerFloor; a++) {
                    const aptRes = await createObject({
                        objectTypeName: "APARTMENT",
                        displayName: `Apt ${f}.${a}`,
                        tenantId,
                        projectId,
                    });
                    await createLink({
                        sourceId: floorId,
                        targetId: aptRes.object.id,
                        linkTypeName: "CONTAINS",
                    });
                }
            }

            handleClose();
            onComplete();
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to create building structure");
        } finally {
            setCreating(false);
        }
    }, [buildingName, floorCount, apartmentsPerFloor, tenantId, projectId, handleClose, onComplete]);

    const canGoNext = () => {
        if (step === 0) return buildingName.trim().length > 0;
        return true;
    };

    const handleNext = () => {
        if (step < STEPS.length - 1) {
            setStep(step + 1);
        } else {
            handleCreate();
        }
    };

    return (
        <WizardShell
            open={open}
            onClose={handleClose}
            title="Set Up Building"
            steps={STEPS}
            currentStep={step}
            onBack={() => setStep(step - 1)}
            onNext={handleNext}
            nextDisabled={!canGoNext()}
            loading={creating}
            nextLabel={step === STEPS.length - 1 ? `Create ${totalItems} items` : undefined}
        >
            {step === 0 && (
                <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                        What is this building called? Use the address or a name your client recognizes.
                    </p>
                    <Input
                        label="Building Name"
                        placeholder="e.g. Hauptstr. 12 or Building A"
                        value={buildingName}
                        onChange={(e) => setBuildingName(e.target.value)}
                        autoFocus
                        onKeyDown={(e) => { if (e.key === "Enter" && canGoNext()) handleNext(); }}
                    />
                </div>
            )}

            {step === 1 && (
                <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                        How many floors does <strong>{buildingName}</strong> have?
                    </p>
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => setFloorCount(Math.max(1, floorCount - 1))}
                            className="h-10 w-10 rounded-lg border border-border text-lg font-medium hover:bg-muted transition-colors"
                        >
                            -
                        </button>
                        <span className="text-2xl font-semibold text-foreground w-12 text-center tabular-nums">
                            {floorCount}
                        </span>
                        <button
                            onClick={() => setFloorCount(Math.min(20, floorCount + 1))}
                            className="h-10 w-10 rounded-lg border border-border text-lg font-medium hover:bg-muted transition-colors"
                        >
                            +
                        </button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Floors will be named "Floor 1", "Floor 2", etc. You can rename them later.
                    </p>
                </div>
            )}

            {step === 2 && (
                <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                        How many apartments per floor? Set to 0 if not applicable.
                    </p>
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => setApartmentsPerFloor(Math.max(0, apartmentsPerFloor - 1))}
                            className="h-10 w-10 rounded-lg border border-border text-lg font-medium hover:bg-muted transition-colors"
                        >
                            -
                        </button>
                        <span className="text-2xl font-semibold text-foreground w-12 text-center tabular-nums">
                            {apartmentsPerFloor}
                        </span>
                        <button
                            onClick={() => setApartmentsPerFloor(Math.min(20, apartmentsPerFloor + 1))}
                            className="h-10 w-10 rounded-lg border border-border text-lg font-medium hover:bg-muted transition-colors"
                        >
                            +
                        </button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Apartments will be named "Apt 1.1", "Apt 1.2", etc. You can rename them later.
                    </p>
                </div>
            )}

            {step === 3 && (
                <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                        Here's what will be created:
                    </p>
                    <div className="rounded-lg border border-border divide-y divide-border/50">
                        <div className="flex items-center gap-3 px-4 py-3">
                            <Building2 className="h-4 w-4 text-blue-500 shrink-0" />
                            <span className="text-sm font-medium text-foreground">{buildingName}</span>
                            <span className="text-xs text-muted-foreground ml-auto">Building</span>
                        </div>
                        {Array.from({ length: floorCount }, (_, f) => (
                            <div key={f}>
                                <div className="flex items-center gap-3 px-4 py-2 pl-8">
                                    <Layers className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                                    <span className="text-sm text-foreground">Floor {f + 1}</span>
                                    <span className="text-xs text-muted-foreground ml-auto">Floor</span>
                                </div>
                                {Array.from({ length: apartmentsPerFloor }, (_, a) => (
                                    <div key={a} className="flex items-center gap-3 px-4 py-1.5 pl-14">
                                        <Home className="h-3 w-3 text-emerald-500 shrink-0" />
                                        <span className="text-xs text-muted-foreground">Apt {f + 1}.{a + 1}</span>
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                        {totalItems} items will be created with all connections set up automatically.
                    </p>
                    {error && (
                        <p className="text-xs text-danger">{error}</p>
                    )}
                </div>
            )}
        </WizardShell>
    );
}
