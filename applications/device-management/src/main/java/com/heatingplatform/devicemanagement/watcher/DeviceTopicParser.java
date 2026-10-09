package com.heatingplatform.devicemanagement.watcher;

import java.util.Optional;

/**
 * Extracts the device id from an MQTT topic, mirroring the routing
 * conventions of the ingestion service's parsers (see
 * ingestion-service/src/parser): Shelly Gen2+ status topics, Tasmota
 * tele/stat topics, and the generic first-segment convention.
 */
public final class DeviceTopicParser {

    private DeviceTopicParser() {
    }

    public static Optional<String> extractDeviceId(String topic) {
        if (topic == null || topic.isBlank() || topic.startsWith("$")) {
            return Optional.empty();
        }

        // Shelly Gen2+: <device-id>/status/<component>
        int statusIdx = topic.indexOf("/status/");
        if (statusIdx > 0) {
            return Optional.of(topic.substring(0, statusIdx));
        }

        // Shelly Gen2+ RPC event stream: <device-id>/events/rpc
        int eventsIdx = topic.indexOf("/events/");
        if (eventsIdx > 0) {
            return Optional.of(topic.substring(0, eventsIdx));
        }

        String[] segments = topic.split("/");

        // Tasmota: tele/<device-id>/<type> or stat/<device-id>/<type>
        if (segments.length >= 3 && (segments[0].equals("tele") || segments[0].equals("stat"))) {
            return segments[1].isBlank() ? Optional.empty() : Optional.of(segments[1]);
        }

        // Generic convention: first segment = device id (needs at least one more segment)
        if (segments.length >= 2 && !segments[0].isBlank()) {
            return Optional.of(segments[0]);
        }

        return Optional.empty();
    }
}
