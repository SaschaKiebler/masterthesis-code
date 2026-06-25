"use client";

/**
 * AddSensorWizard — multi-step wizard to add a sensor to an existing location.
 * Steps: Pick location → Pick sensor type → Pick template → Name & device ID → Done
 */

import { useState, useMemo, useCallback, useRef } from "react";
import { WizardShell, type WizardStep } from "./WizardShell";
import { Input } from "@/components/ui/Input";
import { createObject, createLink, updateDeviceConfig, updateObjectProperties } from "@/lib/api/graph";
import { cn } from "@/lib/utils/cn";
import type { GraphObject, ObjectType, DeviceTemplate } from "@/lib/api/types";
import { useDeviceTemplates } from "@/lib/hooks/useRegistry";
import {
    Building2, Layers, Home, DoorOpen, Warehouse, Wrench, Cpu,
    Radio, Router, Flame, Droplets, Gauge, Zap, Search, Check, Sparkles,
} from "lucide-react";

const STEPS: WizardStep[] = [
    { label: "Location" },
    { label: "Sensor Type" },
    { label: "Template" },
    { label: "Details" },
];

const ICON_MAP: Record<string, React.ElementType> = {
    BUILDING: Building2, FLOOR: Layers, APARTMENT: Home, ROOM: DoorOpen,
    BASEMENT: Warehouse, COMMON_AREA: Building2, TECHNICAL_ROOM: Wrench,
    GENERIC_SENSOR: Cpu, ACTUATOR: Radio, CONTROLLER: Router,
    GATEWAY: Router, BOILER: Flame, PUMP: Droplets, HEAT_METER: Gauge,
    ENERGY_METER: Zap, WATER_METER: Droplets, TEMPERATURE_SENSOR: Gauge,
    VALVE_ACTUATOR: Radio,
};

const DEVICE_CATEGORIES = new Set(["DEVICE", "SENSOR", "ACTUATOR", "CONTROLLER", "GATEWAY", "METER"]);

interface AddSensorWizardProps {
    open: boolean;
    onClose: () => void;
    tenantId: string;
    projectId: string;
    objects: GraphObject[];
    objectTypes: ObjectType[];
    onComplete: () => void;
}

export function AddSensorWizard({
    open,
    onClose,
    tenantId,
    projectId,
    objects,
    objectTypes,
    onComplete,
}: AddSensorWizardProps) {
    const [step, setStep] = useState(0);
    const [selectedLocation, setSelectedLocation] = useState<GraphObject | null>(null);
    const [selectedType, setSelectedType] = useState<ObjectType | null>(null);
    const [selectedTemplate, setSelectedTemplate] = useState<DeviceTemplate | null>(null);
    const [sensorName, setSensorName] = useState("");
    const [deviceId, setDeviceId] = useState("");
    const [creating, setCreating] = useState(false);
    const creatingRef = useRef(false);
    const [error, setError] = useState<string | null>(null);
    const [locationSearch, setLocationSearch] = useState("");
    const [typeSearch, setTypeSearch] = useState("");
    const [templateSearch, setTemplateSearch] = useState("");

    const { templates: allTemplates } = useDeviceTemplates();

    // Locations = buildings, floors, apartments, rooms (things you install sensors IN)
    const locationObjects = useMemo(() => {
        const locationCategories = new Set(["STRUCTURE", "SPACE"]);
        let filtered = objects.filter(o => locationCategories.has(o.objectTypeCategory));
        if (locationSearch.trim()) {
            const q = locationSearch.toLowerCase();
            filtered = filtered.filter(o => o.displayName.toLowerCase().includes(q));
        }
        return filtered;
    }, [objects, locationSearch]);

    // Sensor/device types only
    const deviceTypes = useMemo(() => {
        let filtered = objectTypes.filter(t => DEVICE_CATEGORIES.has(t.category));
        if (typeSearch.trim()) {
            const q = typeSearch.toLowerCase();
            filtered = filtered.filter(t =>
                t.displayName.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)
            );
        }
        return filtered;
    }, [objectTypes, typeSearch]);

    // Templates filtered by selected object type
    const filteredTemplates = useMemo(() => {
        if (!selectedType) return [];
        let filtered = allTemplates.filter(
            (t) => t.objectType?.name === selectedType.name || !t.objectType
        );
        if (templateSearch.trim()) {
            const q = templateSearch.toLowerCase();
            filtered = filtered.filter(t =>
                t.name.toLowerCase().includes(q)
                || (t.manufacturer ?? "").toLowerCase().includes(q)
                || (t.protocol ?? "").toLowerCase().includes(q)
            );
        }
        return filtered;
    }, [allTemplates, selectedType, templateSearch]);

    const reset = useCallback(() => {
        setStep(0);
        setSelectedLocation(null);
        setSelectedType(null);
        setSelectedTemplate(null);
        setSensorName("");
        setDeviceId("");
        setError(null);
        setLocationSearch("");
        setTypeSearch("");
        setTemplateSearch("");
        creatingRef.current = false;
    }, []);

    const handleClose = useCallback(() => {
        reset();
        onClose();
    }, [reset, onClose]);

    const handleCreate = useCallback(async () => {
        if (!selectedType || creatingRef.current) return;
        creatingRef.current = true;
        setCreating(true);
        setError(null);
        try {
            // 1. Create the object
            const res = await createObject({
                objectTypeName: selectedType.name,
                displayName: sensorName.trim() || `New ${selectedType.displayName}`,
                tenantId,
                projectId,
            });

            const objectId = res.object.id;

            // 2. Set device config via PATCH /objects/{id}/device
            const hasDeviceId = !!deviceId.trim();
            const hasTemplate = !!selectedTemplate;

            if (hasDeviceId || hasTemplate) {
                const configPayload: {
                    deviceId?: string;
                    modelHuman?: string;
                    signalMap?: string;
                } = {};

                if (hasDeviceId) {
                    configPayload.deviceId = deviceId.trim();
                }

                if (hasTemplate) {
                    configPayload.modelHuman = `${selectedTemplate.manufacturer ?? ""} ${selectedTemplate.name}`.trim();
                    if (selectedTemplate.defaultSignalMap) {
                        configPayload.signalMap = selectedTemplate.defaultSignalMap;
                    }
                }

                await updateDeviceConfig(objectId, configPayload);
            }

            // 2b. Auto-populate custom properties from template (ADR-014)
            if (hasTemplate && selectedTemplate) {
                const customProps: Record<string, string> = {};
                if (selectedTemplate.manufacturer) customProps.manufacturer = selectedTemplate.manufacturer;
                if (selectedTemplate.modelNumber) customProps.model_number = selectedTemplate.modelNumber;
                if (selectedTemplate.protocol) customProps.protocol = selectedTemplate.protocol;
                if (selectedTemplate.defaultSpecs) {
                    try { Object.assign(customProps, JSON.parse(selectedTemplate.defaultSpecs)); } catch { /* ignore */ }
                }
                if (Object.keys(customProps).length > 0) {
                    try { await updateObjectProperties(objectId, customProps); } catch { /* best-effort */ }
                }
            }

            // 3. Link to location if one was selected
            if (selectedLocation) {
                await createLink({
                    sourceId: objectId,
                    targetId: selectedLocation.id,
                    linkTypeName: "INSTALLED_IN",
                });
            }

            handleClose();
            onComplete();
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to create sensor");
        } finally {
            creatingRef.current = false;
            setCreating(false);
        }
    }, [selectedType, selectedLocation, selectedTemplate, sensorName, deviceId, tenantId, projectId, handleClose, onComplete]);

    const canGoNext = () => {
        if (step === 0) return true; // Location is optional
        if (step === 1) return selectedType !== null;
        if (step === 2) return true; // Template is optional
        return true;
    };

    const handleNext = () => {
        if (creatingRef.current) return;
        // Pre-fill sensor name when moving past sensor type step
        if (step === 1 && selectedType && !sensorName) {
            setSensorName(`New ${selectedType.displayName}`);
        }
        if (step < STEPS.length - 1) {
            setStep(step + 1);
        } else {
            handleCreate();
        }
    };

    const nextLabel = (() => {
        if (step === 0 && !selectedLocation) return "Skip — no location";
        if (step === 2 && !selectedTemplate) return "Skip — no template";
        if (step === STEPS.length - 1) return "Create Sensor";
        return undefined;
    })();

    return (
        <WizardShell
            open={open}
            onClose={handleClose}
            title="Add Sensor"
            steps={STEPS}
            currentStep={step}
            onBack={() => setStep(step - 1)}
            onNext={handleNext}
            nextDisabled={!canGoNext()}
            loading={creating}
            nextLabel={nextLabel}
        >
            {/* Step 0: Location */}
            {step === 0 && (
                <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                        Where will this sensor be installed? Pick a building, floor, or room.
                    </p>
                    <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                        <input
                            type="text"
                            placeholder="Search locations..."
                            value={locationSearch}
                            onChange={(e) => setLocationSearch(e.target.value)}
                            autoFocus
                            className="w-full h-8 pl-8 pr-3 text-sm bg-background border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                    </div>
                    <div className="max-h-[280px] overflow-y-auto space-y-1">
                        {locationObjects.length === 0 ? (
                            <p className="text-xs text-muted-foreground text-center py-4">
                                {objects.length === 0
                                    ? "No buildings yet. You can skip this step and add the sensor without a location."
                                    : "No matching locations found."
                                }
                            </p>
                        ) : (
                            locationObjects.map((obj) => {
                                const Icon = ICON_MAP[obj.objectTypeName] ?? Building2;
                                const isSelected = selectedLocation?.id === obj.id;
                                return (
                                    <button
                                        key={obj.id}
                                        onClick={() => setSelectedLocation(isSelected ? null : obj)}
                                        className={cn(
                                            "flex items-center gap-2.5 w-full px-3 py-2 rounded-lg border transition-colors text-left",
                                            isSelected
                                                ? "border-primary bg-primary/5"
                                                : "border-border hover:border-primary/30 hover:bg-muted/30"
                                        )}
                                    >
                                        <Icon className={cn("h-4 w-4 shrink-0", isSelected ? "text-primary" : "text-muted-foreground")} />
                                        <span className="text-sm text-foreground truncate flex-1">{obj.displayName}</span>
                                        <span className="text-[10px] text-muted-foreground shrink-0">
                                            {obj.objectTypeDisplayName || obj.objectTypeName.replace(/_/g, " ").toLowerCase()}
                                        </span>
                                        {isSelected && <Check className="h-4 w-4 text-primary shrink-0" />}
                                    </button>
                                );
                            })
                        )}
                    </div>
                </div>
            )}

            {/* Step 1: Sensor Type */}
            {step === 1 && (
                <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                        What type of sensor or device?
                    </p>
                    <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                        <input
                            type="text"
                            placeholder="Search (e.g. temperature, meter, valve)..."
                            value={typeSearch}
                            onChange={(e) => setTypeSearch(e.target.value)}
                            autoFocus
                            className="w-full h-8 pl-8 pr-3 text-sm bg-background border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                    </div>
                    <div className="max-h-[280px] overflow-y-auto grid grid-cols-2 gap-1.5">
                        {deviceTypes.map((ot) => {
                            const Icon = ICON_MAP[ot.name] ?? Cpu;
                            const isSelected = selectedType?.id === ot.id;
                            return (
                                <button
                                    key={ot.id}
                                    onClick={() => setSelectedType(ot)}
                                    className={cn(
                                        "flex items-center gap-2 px-2.5 py-2 rounded-lg border transition-colors text-left",
                                        isSelected
                                            ? "border-primary bg-primary/5"
                                            : "border-border hover:border-primary/40 hover:bg-muted/50"
                                    )}
                                >
                                    <div className={cn("p-1 rounded", isSelected ? "bg-primary/10 text-primary" : "bg-amber-500/10 text-amber-500")}>
                                        <Icon className="h-3.5 w-3.5" />
                                    </div>
                                    <span className="text-xs font-medium text-foreground truncate">{ot.displayName}</span>
                                </button>
                            );
                        })}
                        {deviceTypes.length === 0 && (
                            <p className="col-span-2 text-xs text-muted-foreground text-center py-4">No matching sensor types found.</p>
                        )}
                    </div>
                </div>
            )}

            {/* Step 2: Device Template */}
            {step === 2 && (
                <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                        Pick a device template to pre-configure the signal map and model info.
                    </p>
                    {filteredTemplates.length > 0 && (
                        <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                            <input
                                type="text"
                                placeholder="Search templates..."
                                value={templateSearch}
                                onChange={(e) => setTemplateSearch(e.target.value)}
                                autoFocus
                                className="w-full h-8 pl-8 pr-3 text-sm bg-background border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                        </div>
                    )}
                    <div className="max-h-[280px] overflow-y-auto space-y-1.5">
                        {filteredTemplates.length === 0 ? (
                            <p className="text-xs text-muted-foreground text-center py-4">
                                No templates available for this sensor type. You can skip this step and configure the device later.
                            </p>
                        ) : (
                            filteredTemplates.map((t) => {
                                const isSelected = selectedTemplate?.id === t.id;
                                return (
                                    <button
                                        key={t.id}
                                        onClick={() => setSelectedTemplate(isSelected ? null : t)}
                                        className={cn(
                                            "flex items-center gap-3 w-full px-3 py-2.5 rounded-lg border transition-colors text-left",
                                            isSelected
                                                ? "border-primary bg-primary/5"
                                                : "border-border hover:border-primary/30 hover:bg-muted/30"
                                        )}
                                    >
                                        <div className={cn(
                                            "p-1.5 rounded-md shrink-0",
                                            isSelected ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                                        )}>
                                            <Sparkles className="h-3.5 w-3.5" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium text-foreground truncate">{t.name}</p>
                                            <div className="flex items-center gap-1.5 mt-0.5">
                                                {t.manufacturer && (
                                                    <span className="text-[11px] text-muted-foreground">{t.manufacturer}</span>
                                                )}
                                                {t.protocol && (
                                                    <span className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground">
                                                        {t.protocol}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        {isSelected && <Check className="h-4 w-4 text-primary shrink-0" />}
                                    </button>
                                );
                            })
                        )}
                    </div>
                </div>
            )}

            {/* Step 3: Details */}
            {step === 3 && (
                <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                        Give this sensor a name and enter its device ID for MQTT data.
                    </p>
                    <Input
                        label="Sensor Name"
                        placeholder={`e.g. ${selectedType?.displayName ?? "Sensor"} — Living Room`}
                        value={sensorName}
                        onChange={(e) => setSensorName(e.target.value)}
                        autoFocus
                    />
                    <Input
                        label="Device ID"
                        placeholder="e.g. shelly1pm-abc123"
                        value={deviceId}
                        onChange={(e) => setDeviceId(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && !creating) handleNext(); }}
                    />
                    <p className="text-[11px] text-muted-foreground">
                        The device ID is used to match incoming MQTT messages to this sensor.
                    </p>
                    {selectedTemplate && (
                        <p className="text-xs text-muted-foreground">
                            Template <strong>{selectedTemplate.name}</strong> will be applied.
                        </p>
                    )}
                    {selectedLocation && (
                        <p className="text-xs text-muted-foreground">
                            Will be connected to <strong>{selectedLocation.displayName}</strong>.
                        </p>
                    )}
                    {error && (
                        <p className="text-xs text-danger">{error}</p>
                    )}
                </div>
            )}
        </WizardShell>
    );
}
