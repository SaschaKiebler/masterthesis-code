package com.digitaldemon.devicemanagement.watcher;

import com.digitaldemon.device.proto.v1.DeviceDiscovered;
import com.digitaldemon.devicemanagement.config.DeviceManagementProperties;
import com.digitaldemon.devicemanagement.mqtt.MqttConnection;
import com.digitaldemon.devicemanagement.projection.DeviceConfigProjection;
import com.google.protobuf.Timestamp;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.eclipse.paho.client.mqttv3.MqttException;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.annotation.Order;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Continuously watches the MQTT broker and publishes a `device.discovered`
 * event for every device that talks on the broker but has no configuration
 * (see docs/architecture/event-catalog.md). Core-platform consumes the events
 * into its registry so the UI can offer onboarding.
 *
 * Known devices come from the config projection's published state; events per
 * device are throttled so chatty devices do not flood the topic.
 */
@Slf4j
@Component
@RequiredArgsConstructor
@ConditionalOnProperty(name = "mqtt.enabled", havingValue = "true", matchIfMissing = true)
public class BrokerWatcher {

    private final MqttConnection mqtt;
    private final DeviceConfigProjection projection;
    private final KafkaTemplate<Object, Object> kafka;
    private final DeviceManagementProperties props;

    /** device id → last time a discovered event was published. */
    private final ConcurrentHashMap<String, Instant> lastAnnounced = new ConcurrentHashMap<>();

    /**
     * Registered after MqttConnection connected (both listen to
     * ApplicationReadyEvent; order ensures the connection exists first).
     */
    @EventListener(ApplicationReadyEvent.class)
    @Order(10)
    public void start() {
        try {
            mqtt.registerHandler("broker-watcher", (topic, message) ->
                    onMessage(topic, new String(message.getPayload(), StandardCharsets.UTF_8)));
            log.info("Broker watcher active on the shared catch-all stream");
        } catch (MqttException e) {
            log.error("Broker watcher could not attach: {} — unknown devices will not be discovered",
                    e.getMessage());
        }
    }

    void onMessage(String topic, String payload) {
        // Until the first projection sweep ran, "unknown" cannot be trusted.
        if (!projection.isReady()) {
            return;
        }

        DeviceTopicParser.extractDeviceId(topic).ifPresent(deviceId -> {
            if (projection.isKnownDevice(deviceId)) {
                return;
            }

            Instant now = Instant.now();
            Duration throttle = Duration.ofMinutes(props.getWatcher().getDiscoveredThrottleMinutes());
            Instant last = lastAnnounced.get(deviceId);
            if (last != null && Duration.between(last, now).compareTo(throttle) < 0) {
                return;
            }
            lastAnnounced.put(deviceId, now);

            int maxChars = props.getWatcher().getSamplePayloadMaxChars();
            String sample = payload.length() > maxChars ? payload.substring(0, maxChars) : payload;

            DeviceDiscovered event = DeviceDiscovered.newBuilder()
                    .setDeviceId(deviceId)
                    .setProtocol("MQTT")
                    .setSampleTopic(topic)
                    .setSamplePayload(sample)
                    .setSeenAt(Timestamp.newBuilder()
                            .setSeconds(now.getEpochSecond())
                            .setNanos(now.getNano()))
                    .build();

            kafka.send(props.getTopics().getDeviceDiscovered(),
                    deviceId.getBytes(StandardCharsets.UTF_8),
                    event.toByteArray());
            log.info("Published device.discovered for unknown device {} (topic={})", deviceId, topic);
        });
    }
}
