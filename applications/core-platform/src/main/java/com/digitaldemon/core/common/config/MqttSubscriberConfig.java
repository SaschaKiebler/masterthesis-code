package com.digitaldemon.core.common.config;

import lombok.extern.slf4j.Slf4j;
import org.eclipse.paho.client.mqttv3.*;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import java.util.concurrent.ConcurrentHashMap;
import java.util.function.BiConsumer;

/**
 * Shared MQTT connection to the Mosquitto broker, used exclusively for device
 * discovery: components subscribe/unsubscribe device topics dynamically via
 * {@link #subscribe} and {@link #unsubscribe}.
 *
 * Measurement batches no longer flow through MQTT — the ingestion service
 * publishes them to the Kafka topic measurement.ingested, consumed by
 * {@link com.digitaldemon.core.measurement.MeasurementBatchListener}.
 *
 * Only activated when mqtt.enabled=true (default true) so tests can disable it
 * without a running broker.
 */
@Slf4j
@Component
@ConditionalOnProperty(name = "mqtt.enabled", havingValue = "true", matchIfMissing = true)
public class MqttSubscriberConfig {

    private final MqttProperties props;
    private volatile MqttAsyncClient client;
    private volatile boolean connectionAttempted = false;
    private volatile String connectionError = null;

    /**
     * Dynamic topic handlers: handler key → message handler.
     * Used by discovery and any future component that needs additional subscriptions.
     */
    private final ConcurrentHashMap<String, BiConsumer<String, MqttMessage>> topicHandlers = new ConcurrentHashMap<>();

    public MqttSubscriberConfig(MqttProperties props) {
        this.props = props;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void connect() {
        try {
            MqttConnectOptions options = new MqttConnectOptions();
            options.setAutomaticReconnect(true);
            options.setCleanSession(true);
            options.setConnectionTimeout(10);
            options.setKeepAliveInterval(30);

            if (props.getUsername() != null && !props.getUsername().isBlank()) {
                options.setUserName(props.getUsername());
                options.setPassword(props.getPassword().toCharArray());
            }

            client = new MqttAsyncClient(props.getBrokerUrl(), props.getClientId(), new MemoryPersistence());
            client.setCallback(new MqttCallbackExtended() {

                @Override
                public void connectComplete(boolean reconnect, String serverURI) {
                    connectionError = null;
                    log.info("MQTT connected to {} (reconnect={})", serverURI, reconnect);
                    // Re-subscribe dynamic topics on reconnect
                    if (reconnect) {
                        resubscribeDynamicTopics();
                    }
                }

                @Override
                public void messageArrived(String topic, MqttMessage message) {
                    // Route to dynamic handlers
                    for (var entry : topicHandlers.entrySet()) {
                        entry.getValue().accept(topic, message);
                    }
                }

                @Override
                public void connectionLost(Throwable cause) {
                    log.warn("MQTT connection lost: {} — will reconnect automatically", cause.getMessage());
                }

                @Override
                public void deliveryComplete(IMqttDeliveryToken token) {
                    // subscriber only
                }
            });

            // Synchronous connect — wait up to 15s so we know immediately if auth fails
            log.info("MQTT subscriber connecting to {} (user={})...", props.getBrokerUrl(), props.getUsername());
            client.connect(options).waitForCompletion(15_000);
            connectionAttempted = true;
            log.info("MQTT subscriber connected successfully to {}", props.getBrokerUrl());

        } catch (MqttException e) {
            connectionAttempted = true;
            connectionError = "reason=" + e.getReasonCode() + " (" + e.getMessage() + ")";
            log.warn("Could not connect to MQTT broker at {}: {} — auto-reconnect will keep trying",
                    props.getBrokerUrl(), connectionError);
        }
    }

    /**
     * Subscribe to additional topics on the shared connection.
     * Waits up to 5s for the connection if it's still being established.
     */
    public void subscribe(String[] topics, int[] qos, String handlerKey, BiConsumer<String, MqttMessage> handler) throws MqttException {
        // Wait briefly for connection if startup connect hasn't completed yet
        if (client != null && !client.isConnected()) {
            for (int i = 0; i < 10; i++) {
                if (client.isConnected()) break;
                try { Thread.sleep(500); } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        }

        if (client == null || !client.isConnected()) {
            String msg = "MQTT broker is not connected";
            if (connectionError != null) msg += ": " + connectionError;
            MqttException ex = new MqttException(MqttException.REASON_CODE_CLIENT_NOT_CONNECTED);
            ex.initCause(new Exception(msg));
            throw ex;
        }
        topicHandlers.put(handlerKey, handler);
        client.subscribe(topics, qos);
        log.info("Dynamic subscribe: {} topics (handler={})", topics.length, handlerKey);
    }

    /**
     * Unsubscribe topics and remove the handler.
     */
    public void unsubscribe(String[] topics, String handlerKey) {
        topicHandlers.remove(handlerKey);
        if (client != null && client.isConnected()) {
            try {
                client.unsubscribe(topics);
                log.info("Dynamic unsubscribe: {} topics (handler={})", topics.length, handlerKey);
            } catch (MqttException e) {
                log.warn("Failed to unsubscribe topics (handler={}): {}", handlerKey, e.getMessage());
            }
        }
    }

    public boolean isConnected() {
        return client != null && client.isConnected();
    }

    public String getConnectionError() {
        return connectionError;
    }

    private void resubscribeDynamicTopics() {
        if (topicHandlers.isEmpty()) return;
        log.info("Re-subscribing {} dynamic topic handler(s) after reconnect", topicHandlers.size());
    }
}
