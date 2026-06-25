import {
    Building2, Layers, Home, DoorOpen, Warehouse, Wrench, Cpu,
    Radio, Router, Flame, Droplets, Gauge, Zap, User, GitBranch, Network,
} from "lucide-react";

// ─── Shared icon maps ─────────────────────────────────────────────────────────

export const ICON_MAP: Record<string, React.ElementType> = {
    BUILDING: Building2, FLOOR: Layers, APARTMENT: Home, ROOM: DoorOpen,
    BASEMENT: Warehouse, COMMON_AREA: Building2, TECHNICAL_ROOM: Wrench,
    HEATING_CIRCUIT: GitBranch, HEATING_ZONE: Network, DISTRIBUTION_NETWORK: Network,
    PERSON: User, GENERIC_SENSOR: Cpu, ACTUATOR: Radio, CONTROLLER: Router,
    GATEWAY: Router, BOILER: Flame, PUMP: Droplets, HEAT_METER: Gauge, ENERGY_METER: Zap,
    WATER_METER: Droplets, TEMPERATURE_SENSOR: Gauge, VALVE_ACTUATOR: Radio,
};

export const CATEGORY_COLOR: Record<string, string> = {
    STRUCTURE: "text-blue-500",
    SPACE: "text-emerald-500",
    DEVICE: "text-amber-500",
    SYSTEM: "text-purple-500",
    CONTACT: "text-pink-500",
};

export const CATEGORY_BG: Record<string, string> = {
    STRUCTURE: "bg-blue-500/10 text-blue-500",
    SPACE: "bg-emerald-500/10 text-emerald-500",
    DEVICE: "bg-amber-500/10 text-amber-500",
    SYSTEM: "bg-purple-500/10 text-purple-500",
    CONTACT: "bg-pink-500/10 text-pink-500",
};
