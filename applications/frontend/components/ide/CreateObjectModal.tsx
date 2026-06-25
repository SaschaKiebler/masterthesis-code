"use client";

/**
 * CreateObjectModal — modal for creating a new object in the IDE.
 * Shows object types grouped by category with icons.
 * User picks a type, enters a name, and submits.
 * Includes inline "Create New Type" flow via ObjectTypeModal.
 */

import { useState, useMemo, useEffect } from "react";
import { Modal, ModalHeader, ModalContent, ModalFooter } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils/cn";
import { ObjectTypeModal } from "@/components/templates/ObjectTypeModal";
import type { ObjectType } from "@/lib/api/types";
import {
    Building2, Layers, Home, DoorOpen, Warehouse, Wrench, Cpu,
    Radio, Router, Flame, Droplets, Gauge, Zap, User, GitBranch, Network,
    Search, Plus,
} from "lucide-react";

const ICON_MAP: Record<string, React.ElementType> = {
    BUILDING: Building2, FLOOR: Layers, APARTMENT: Home, ROOM: DoorOpen,
    BASEMENT: Warehouse, COMMON_AREA: Building2, TECHNICAL_ROOM: Wrench,
    HEATING_CIRCUIT: GitBranch, HEATING_ZONE: Network, DISTRIBUTION_NETWORK: Network,
    PERSON: User, GENERIC_SENSOR: Cpu, ACTUATOR: Radio, CONTROLLER: Router,
    GATEWAY: Router, BOILER: Flame, PUMP: Droplets, HEAT_METER: Gauge, ENERGY_METER: Zap,
    WATER_METER: Droplets, TEMPERATURE_SENSOR: Gauge, VALVE_ACTUATOR: Radio,
};

const CATEGORY_COLOR: Record<string, string> = {
    STRUCTURE: "text-blue-500 bg-blue-500/10",
    SPACE: "text-emerald-500 bg-emerald-500/10",
    DEVICE: "text-amber-500 bg-amber-500/10",
    SYSTEM: "text-purple-500 bg-purple-500/10",
    CONTACT: "text-pink-500 bg-pink-500/10",
    SENSOR: "text-amber-500 bg-amber-500/10",
    ACTUATOR: "text-amber-500 bg-amber-500/10",
    CONTROLLER: "text-amber-500 bg-amber-500/10",
    GATEWAY: "text-amber-500 bg-amber-500/10",
    METER: "text-amber-500 bg-amber-500/10",
};

const CATEGORY_ORDER = ["STRUCTURE", "SPACE", "SYSTEM", "DEVICE", "SENSOR", "ACTUATOR", "CONTROLLER", "GATEWAY", "METER", "CONTACT"];

const CATEGORY_LABELS: Record<string, string> = {
    STRUCTURE: "Buildings & Floors",
    SPACE: "Rooms & Spaces",
    SYSTEM: "Heating Systems",
    DEVICE: "Devices",
    SENSOR: "Sensors",
    ACTUATOR: "Actuators",
    CONTROLLER: "Controllers",
    GATEWAY: "Gateways",
    METER: "Meters",
    CONTACT: "People",
};

interface CreateObjectModalProps {
    open: boolean;
    onClose: () => void;
    objectTypes: ObjectType[];
    preselectedCategory?: string;
    onCreateObject: (objectTypeName: string, displayName: string) => Promise<void>;
    onRefreshObjectTypes?: () => void;
}

export function CreateObjectModal({
    open,
    onClose,
    objectTypes,
    preselectedCategory,
    onCreateObject,
    onRefreshObjectTypes,
}: CreateObjectModalProps) {
    const [selectedType, setSelectedType] = useState<ObjectType | null>(null);
    const [displayName, setDisplayName] = useState("");
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState("");

    // Inline ObjectTypeModal state
    const [showCreateType, setShowCreateType] = useState(false);
    // Name of the just-created type, used to auto-select after refresh
    const [pendingAutoSelect, setPendingAutoSelect] = useState<string | null>(null);

    // Auto-select a newly created type when objectTypes updates
    useEffect(() => {
        if (!pendingAutoSelect || objectTypes.length === 0) return;
        const newType = objectTypes.find((t) => t.name === pendingAutoSelect);
        if (newType) {
            setSelectedType(newType);
            setDisplayName(`New ${newType.displayName}`);
            setPendingAutoSelect(null);
        }
    }, [pendingAutoSelect, objectTypes]);

    // Group types by category
    const groups = useMemo(() => {
        const q = search.toLowerCase();
        const filtered = q
            ? objectTypes.filter((t) => t.displayName.toLowerCase().includes(q) || t.name.toLowerCase().includes(q))
            : objectTypes;

        const map = new Map<string, ObjectType[]>();
        for (const ot of filtered) {
            const cat = ot.category;
            if (!map.has(cat)) map.set(cat, []);
            map.get(cat)!.push(ot);
        }
        const result: { category: string; types: ObjectType[] }[] = [];
        for (const cat of CATEGORY_ORDER) {
            if (map.has(cat)) {
                result.push({ category: cat, types: map.get(cat)! });
                map.delete(cat);
            }
        }
        for (const [cat, types] of map) {
            result.push({ category: cat, types });
        }
        return result;
    }, [objectTypes, search]);

    // Auto-select category on open
    const step = selectedType ? "name" : "type";

    async function handleCreate() {
        if (!selectedType || !displayName.trim()) return;
        setCreating(true);
        setError(null);
        try {
            await onCreateObject(selectedType.name, displayName.trim());
            handleClose();
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to create object");
        } finally {
            setCreating(false);
        }
    }

    function handleClose() {
        setSelectedType(null);
        setDisplayName("");
        setSearch("");
        setError(null);
        setPendingAutoSelect(null);
        onClose();
    }

    function handleBack() {
        setSelectedType(null);
        setDisplayName("");
        setError(null);
    }

    function handleObjectTypeCreated(typeName: string) {
        setPendingAutoSelect(typeName);
        setShowCreateType(false);
        onRefreshObjectTypes?.();
    }

    return (
        <>
            <Modal open={open} onClose={handleClose}>
                <ModalHeader onClose={handleClose}>
                    {step === "type" ? "What are you adding?" : `New ${selectedType?.displayName}`}
                </ModalHeader>
                <ModalContent>
                    {step === "type" ? (
                        <div className="space-y-3">
                            {/* Search */}
                            <div className="relative">
                                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                                <input
                                    type="text"
                                    placeholder="Search (e.g. sensor, building, room)..."
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    autoFocus
                                    className="w-full h-8 pl-8 pr-3 text-sm bg-background border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                />
                            </div>

                            {/* Type grid */}
                            <div className="max-h-[400px] overflow-y-auto space-y-3">
                                {groups.map((group) => (
                                    <div key={group.category}>
                                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 px-1">
                                            {CATEGORY_LABELS[group.category] ?? group.category}
                                        </p>
                                        <div className="grid grid-cols-2 gap-1.5">
                                            {group.types.map((ot) => {
                                                const Icon = ICON_MAP[ot.name] ?? Cpu;
                                                const color = CATEGORY_COLOR[ot.category] ?? "text-muted-foreground bg-muted";
                                                return (
                                                    <button
                                                        key={ot.id}
                                                        onClick={() => {
                                                            setSelectedType(ot);
                                                            setDisplayName(`New ${ot.displayName}`);
                                                        }}
                                                        className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-border hover:border-primary/40 hover:bg-muted/50 transition-colors text-left"
                                                    >
                                                        <div className={cn("p-1 rounded", color)}>
                                                            <Icon className="h-3.5 w-3.5" />
                                                        </div>
                                                        <span className="text-xs font-medium text-foreground truncate">
                                                            {ot.displayName}
                                                        </span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ))}
                                {groups.length === 0 && (
                                    <p className="text-xs text-muted-foreground text-center py-4">No types match your search.</p>
                                )}
                            </div>

                            {/* Create new type button */}
                            {onRefreshObjectTypes && (
                                <button
                                    onClick={() => setShowCreateType(true)}
                                    className="flex items-center gap-2 w-full px-3 py-2.5 rounded-lg border border-dashed border-border hover:border-primary/40 hover:bg-muted/50 transition-colors text-left"
                                >
                                    <div className="p-1 rounded bg-primary/10 text-primary">
                                        <Plus className="h-3.5 w-3.5" />
                                    </div>
                                    <span className="text-xs font-medium text-muted-foreground">
                                        Type not listed? Create a new one
                                    </span>
                                </button>
                            )}
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border">
                                {(() => {
                                    const Icon = ICON_MAP[selectedType!.name] ?? Cpu;
                                    const color = CATEGORY_COLOR[selectedType!.category] ?? "text-muted-foreground bg-muted";
                                    return (
                                        <>
                                            <div className={cn("p-1.5 rounded-lg", color)}>
                                                <Icon className="h-4 w-4" />
                                            </div>
                                            <div>
                                                <p className="text-sm font-medium text-foreground">{selectedType!.displayName}</p>
                                                <p className="text-xs text-muted-foreground">{selectedType!.category}</p>
                                            </div>
                                        </>
                                    );
                                })()}
                            </div>
                            <Input
                                label="Display Name"
                                placeholder={`e.g. ${selectedType!.displayName} 1`}
                                value={displayName}
                                onChange={(e) => setDisplayName(e.target.value)}
                                error={error ?? undefined}
                                autoFocus
                                onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
                            />
                        </div>
                    )}
                </ModalContent>
                <ModalFooter>
                    {step === "name" && (
                        <Button variant="ghost" onClick={handleBack}>Back</Button>
                    )}
                    <Button variant="ghost" onClick={handleClose}>Cancel</Button>
                    {step === "name" && (
                        <Button
                            variant="primary"
                            onClick={handleCreate}
                            loading={creating}
                            disabled={!displayName.trim()}
                        >
                            Create
                        </Button>
                    )}
                </ModalFooter>
            </Modal>

            {/* Inline ObjectTypeModal for creating a new type without leaving the IDE */}
            <ObjectTypeModal
                open={showCreateType}
                onClose={() => setShowCreateType(false)}
                onSuccess={(createdName) => {
                    if (createdName) {
                        handleObjectTypeCreated(createdName);
                    } else {
                        setShowCreateType(false);
                    }
                }}
            />
        </>
    );
}
