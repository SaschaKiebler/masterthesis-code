// ─── Device categories that show the config section ─────────────────────────

const DEVICE_CATEGORIES = new Set([
    "SENSOR", "ACTUATOR", "CONTROLLER", "GATEWAY", "DEVICE", "METER",
]);

export function isDeviceCategory(category: string): boolean {
    return DEVICE_CATEGORIES.has(category);
}

export const PROTOCOL_OPTIONS = ["MQTT", "LORA", "WMBUS", "MODBUS", "SHELLY", "ZIGBEE", "ZWAVE", "MBUS"];
