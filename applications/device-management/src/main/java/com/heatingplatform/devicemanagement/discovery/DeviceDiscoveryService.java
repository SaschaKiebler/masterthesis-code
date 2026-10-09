package com.heatingplatform.devicemanagement.discovery;

import com.heatingplatform.devicemanagement.config.DeviceManagementProperties;
import com.heatingplatform.devicemanagement.mqtt.MqttConnection;
import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import org.eclipse.paho.client.mqttv3.MqttException;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

/**
 * Interactive payload-sniffing sessions for template creation, ported from
 * core-platform. Core proxies the REST endpoints and enforces auth; this
 * service owns the broker tap.
 */
@Slf4j
@Service
@RequiredArgsConstructor
@ConditionalOnProperty(name = "device-management.discovery.enabled", havingValue = "true", matchIfMissing = true)
public class DeviceDiscoveryService {

    private final MqttConnection mqtt;
    private final DeviceManagementProperties props;

    private final ConcurrentHashMap<UUID, DiscoverySession> sessions = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<UUID, DiscoveryMqttClient> clients = new ConcurrentHashMap<>();

    public DiscoverySession startDiscovery(String deviceId, UUID tenantId) {
        // Enforce per-tenant session limit
        long activeSessions = sessions.values().stream()
                .filter(s -> s.getTenantId().equals(tenantId))
                .filter(s -> s.getStatus() == DiscoverySession.Status.LISTENING)
                .count();

        if (activeSessions >= props.getDiscovery().getMaxSessionsPerTenant()) {
            throw new IllegalStateException(
                    "Maximum active discovery sessions (" + props.getDiscovery().getMaxSessionsPerTenant()
                            + ") reached for this tenant. Stop an existing session first.");
        }

        DiscoverySession session = new DiscoverySession(deviceId, tenantId);
        sessions.put(session.getSessionId(), session);

        try {
            DiscoveryMqttClient client = new DiscoveryMqttClient(mqtt, props.getDiscovery(), session);
            clients.put(session.getSessionId(), client);
        } catch (MqttException e) {
            sessions.remove(session.getSessionId());
            String detail = "reason=" + e.getReasonCode() + " (" + e.getMessage() + ")";
            if (e.getCause() != null) detail += ", cause=" + e.getCause().getMessage();
            log.error("Failed to attach discovery listener for device '{}': {}", deviceId, detail);
            throw new RuntimeException("Failed to attach to MQTT stream: " + detail, e);
        } catch (Exception e) {
            sessions.remove(session.getSessionId());
            log.error("Failed to start discovery for device '{}': {}", deviceId, e.getMessage(), e);
            throw new RuntimeException("Failed to start discovery: " + e.getMessage(), e);
        }

        log.info("Started discovery session {} for device '{}' (tenant={})",
                session.getSessionId(), deviceId, tenantId);
        return session;
    }

    public DiscoverySession getSession(UUID sessionId) {
        return sessions.get(sessionId);
    }

    public void stopDiscovery(UUID sessionId) {
        DiscoverySession session = sessions.get(sessionId);
        if (session == null) return;

        session.stop();

        DiscoveryMqttClient client = clients.remove(sessionId);
        if (client != null) {
            client.disconnect();
        }

        log.info("Stopped discovery session {} ({} messages captured)",
                sessionId, session.getMessageCount());
    }

    /**
     * Analyze captured payloads to extract field structure and suggest signal map entries.
     */
    public Map<String, Object> analyzePayloads(UUID sessionId) {
        DiscoverySession session = sessions.get(sessionId);
        if (session == null) return Map.of();

        List<CapturedMessage> messages = session.getMessageList();
        if (messages.isEmpty()) {
            Map<String, Object> empty = new LinkedHashMap<>();
            empty.put("fieldsBySource", Map.of());
            empty.put("fieldTypes", Map.of());
            empty.put("suggestedSignalMap", List.of());
            empty.put("detectedProtocol", "UNKNOWN");
            empty.put("messageCount", 0);
            empty.put("sourcesCount", 0);
            return empty;
        }

        // Group JSON fields by MQTT topic "source" component
        Map<String, Set<String>> fieldsBySource = new LinkedHashMap<>();
        Map<String, String> fieldTypes = new LinkedHashMap<>();
        String detectedProtocol = detectProtocol(messages);

        for (CapturedMessage msg : messages) {
            if (msg.getParsedPayload() == null || !msg.getParsedPayload().isObject()) continue;

            String source = extractSource(msg.getTopic(), session.getDeviceId());
            JsonNode payload = msg.getParsedPayload();

            extractFields(payload, "", 0).forEach((fieldName, type) -> {
                fieldsBySource.computeIfAbsent(source, k -> new LinkedHashSet<>()).add(fieldName);
                fieldTypes.putIfAbsent(source + "/" + fieldName, type);
            });
        }

        // Build suggested signal map entries
        List<Map<String, String>> suggestedSignalMap = new ArrayList<>();
        int metricIdx = 1;
        for (Map.Entry<String, Set<String>> entry : fieldsBySource.entrySet()) {
            String source = entry.getKey();
            for (String field : entry.getValue()) {
                String fullKey = source + "/" + field;
                String type = fieldTypes.getOrDefault(fullKey, "string");
                // Only suggest numeric fields as signals
                if (!"number".equals(type)) continue;

                Map<String, String> signal = new LinkedHashMap<>();
                signal.put("metricId", String.valueOf(metricIdx++));
                signal.put("source", source);
                signal.put("field", field);
                signal.put("name", humanize(field));
                signal.put("unit", guessUnit(field));
                signal.put("type", type);
                suggestedSignalMap.add(signal);
            }
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("fieldsBySource", fieldsBySource);
        result.put("fieldTypes", fieldTypes);
        result.put("suggestedSignalMap", suggestedSignalMap);
        result.put("detectedProtocol", detectedProtocol);
        result.put("messageCount", messages.size());
        result.put("sourcesCount", fieldsBySource.size());
        return result;
    }

    /**
     * Extract the "source" component from an MQTT topic relative to the device.
     * e.g. "shellyplus1pm-abc123/status/switch:0" → "switch:0"
     *      "shellies/shellyht-abc/sensor/temperature" → "sensor/temperature"
     */
    private String extractSource(String topic, String deviceId) {
        // Gen2+: {deviceId}/status/{component}
        if (topic.startsWith(deviceId + "/status/")) {
            return topic.substring((deviceId + "/status/").length());
        }
        // Gen1: shellies/{deviceId}/{rest}
        String gen1Prefix = "shellies/" + deviceId + "/";
        if (topic.startsWith(gen1Prefix)) {
            return topic.substring(gen1Prefix.length());
        }
        // Envelope or catch-all: use the part after status/ if present
        int statusIdx = topic.indexOf("/status/");
        if (statusIdx >= 0) {
            return topic.substring(statusIdx + "/status/".length());
        }
        // Fallback: last segment
        int lastSlash = topic.lastIndexOf('/');
        return lastSlash >= 0 ? topic.substring(lastSlash + 1) : topic;
    }

    private String detectProtocol(List<CapturedMessage> messages) {
        for (CapturedMessage msg : messages) {
            String topic = msg.getTopic();
            if (topic.contains("shellies/") || topic.contains("/status/")) return "SHELLY";
            if (topic.startsWith("house/")) return "MQTT";
        }
        return "MQTT";
    }

    /**
     * Recursively extract fields from a JSON object using dot-notation for nested objects.
     * For object fields, both the parent (as "object") and its children are included.
     * Max recursion depth of 2 (matching ingestion parser's resolve_json_field).
     */
    private Map<String, String> extractFields(JsonNode node, String prefix, int depth) {
        Map<String, String> fields = new LinkedHashMap<>();
        node.fieldNames().forEachRemaining(fieldName -> {
            String fullName = prefix.isEmpty() ? fieldName : prefix + "." + fieldName;
            JsonNode value = node.get(fieldName);
            String type = inferType(value);

            fields.put(fullName, type);

            if ("object".equals(type) && depth < 2) {
                fields.putAll(extractFields(value, fullName, depth + 1));
            }
        });
        return fields;
    }

    private String inferType(JsonNode value) {
        if (value == null || value.isNull()) return "null";
        if (value.isNumber()) return "number";
        if (value.isBoolean()) return "boolean";
        if (value.isTextual()) return "string";
        if (value.isArray()) return "array";
        if (value.isObject()) return "object";
        return "unknown";
    }

    private String humanize(String field) {
        // Handle dot-notation: humanize each segment and join with space
        if (field.contains(".")) {
            return Arrays.stream(field.split("\\."))
                    .map(this::humanizeSegment)
                    .collect(Collectors.joining(" "));
        }
        return humanizeSegment(field);
    }

    private String humanizeSegment(String field) {
        // tC → Temperature (C), apower → Active Power, etc.
        return switch (field) {
            case "tC" -> "Temperature (C)";
            case "tF" -> "Temperature (F)";
            case "rh" -> "Relative Humidity";
            case "apower" -> "Active Power";
            case "voltage" -> "Voltage";
            case "current" -> "Current";
            case "freq" -> "Frequency";
            case "aenergy" -> "Active Energy";
            case "pf" -> "Power Factor";
            case "total" -> "Total";
            case "counts" -> "Counts";
            default -> field.substring(0, 1).toUpperCase() + field.substring(1)
                    .replaceAll("([a-z])([A-Z])", "$1 $2")
                    .replaceAll("_", " ");
        };
    }

    private String guessUnit(String field) {
        String lower = field.toLowerCase();
        if (lower.contains("temp") || lower.equals("tc")) return "celsius";
        if (lower.equals("tf")) return "fahrenheit";
        if (lower.contains("humid") || lower.equals("rh")) return "percent";
        if (lower.contains("power") || lower.equals("apower")) return "W";
        if (lower.contains("voltage")) return "V";
        if (lower.contains("current") && !lower.contains("count")) return "A";
        if (lower.contains("freq")) return "Hz";
        if (lower.contains("energy")) return "kWh";
        if (lower.equals("total")) return "kWh";
        if (lower.equals("pf")) return "";
        if (lower.startsWith("count")) return "count";
        return "";
    }

    /**
     * Scheduled cleanup: timeout active sessions after configured duration,
     * remove stale sessions after 15 minutes.
     */
    @Scheduled(fixedDelay = 30_000)
    public void cleanupSessions() {
        Instant now = Instant.now();
        int timeoutSeconds = props.getDiscovery().getSessionTimeoutSeconds();

        for (Map.Entry<UUID, DiscoverySession> entry : sessions.entrySet()) {
            UUID sessionId = entry.getKey();
            DiscoverySession session = entry.getValue();

            // Timeout active sessions
            if (session.getStatus() == DiscoverySession.Status.LISTENING) {
                if (Duration.between(session.getStartedAt(), now).getSeconds() > timeoutSeconds) {
                    session.timeout();
                    DiscoveryMqttClient client = clients.remove(sessionId);
                    if (client != null) client.disconnect();
                    log.info("Discovery session {} timed out after {}s", sessionId, timeoutSeconds);
                }
            }

            // Remove stale sessions (stopped/timed out for > 15 min)
            if (session.getStatus() != DiscoverySession.Status.LISTENING && session.getStoppedAt() != null) {
                if (Duration.between(session.getStoppedAt(), now).toMinutes() > 15) {
                    sessions.remove(sessionId);
                    clients.remove(sessionId); // safety
                    log.debug("Removed stale discovery session {}", sessionId);
                }
            }
        }
    }
}
