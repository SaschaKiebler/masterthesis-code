package com.digitaldemon.core.device;

import com.digitaldemon.core.device.MqttDiscoveryProperties;
import com.digitaldemon.core.common.config.MqttSubscriberConfig;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.eclipse.paho.client.mqttv3.MqttException;

import java.nio.charset.StandardCharsets;

/**
 * Per-session discovery handler that piggybacks on the shared MQTT connection.
 * Subscribes to topic patterns matching the target deviceId, filters relevant
 * messages, and stores them in the associated DiscoverySession.
 */
@Slf4j
public class DiscoveryMqttClient {

    private static final ObjectMapper objectMapper = new ObjectMapper();

    private final MqttSubscriberConfig mqttSubscriber;
    private final DiscoverySession session;
    private final MqttDiscoveryProperties discoveryProps;
    private final String deviceId;
    private final String handlerKey;
    private final String[] topics;

    public DiscoveryMqttClient(
            MqttSubscriberConfig mqttSubscriber,
            MqttDiscoveryProperties discoveryProps,
            DiscoverySession session
    ) throws MqttException {
        this.mqttSubscriber = mqttSubscriber;
        this.session = session;
        this.discoveryProps = discoveryProps;
        this.deviceId = session.getDeviceId();
        this.handlerKey = "discovery-" + session.getSessionId().toString().substring(0, 8);

        this.topics = new String[]{
                "#",                           // Catch-all — needed for non-Shelly devices
        };
        int[] qos = {1};

        mqttSubscriber.subscribe(topics, qos, handlerKey, (topic, message) -> {
            handleMessage(topic, new String(message.getPayload(), StandardCharsets.UTF_8));
        });

        log.info("Discovery subscribed to {} topic patterns for device '{}' (session={})",
                topics.length, deviceId, session.getSessionId());
    }

    private void handleMessage(String topic, String rawPayload) {
        if (session.getStatus() != DiscoverySession.Status.LISTENING) return;
        if (session.getMessageCount() >= discoveryProps.getMaxMessagesPerSession()) return;

        if (!isRelevantMessage(topic, rawPayload)) return;

        JsonNode parsed = null;
        try {
            parsed = objectMapper.readTree(rawPayload);
        } catch (Exception ignored) {
            // not JSON — store raw
        }

        session.addMessage(new CapturedMessage(topic, rawPayload, parsed));
        log.debug("Discovery captured message on '{}' for session {} ({} total)",
                topic, session.getSessionId(), session.getMessageCount());
    }

    /**
     * Determines if a message is relevant to the target device.
     */
    boolean isRelevantMessage(String topic, String rawPayload) {
        String deviceIdLower = deviceId.toLowerCase();

        // Topic contains device ID (covers Shelly Gen2+, Gen1, and generic devices)
        if (topic.toLowerCase().contains(deviceIdLower)) return true;

        // Payload contains device ID (covers envelope formats and embedded identifiers)
        if (rawPayload != null && rawPayload.toLowerCase().contains(deviceIdLower)) return true;

        return false;
    }

    public void disconnect() {
        mqttSubscriber.unsubscribe(topics, handlerKey);
        log.info("Discovery unsubscribed topics for session {}", session.getSessionId());
    }
}
