package com.digitaldemon.devicemanagement.mqtt;

import lombok.extern.slf4j.Slf4j;
import org.eclipse.paho.client.mqttv3.*;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import java.util.concurrent.ConcurrentHashMap;
import java.util.function.BiConsumer;

/**
 * Shared MQTT connection to the Mosquitto broker (moved here from
 * core-platform, which no longer holds any broker connection).
 *
 * The connection maintains a single catch-all subscription (`#`) and fans
 * every message out to registered handlers: the always-on broker watcher and
 * short-lived interactive discovery sessions. Handlers filter for themselves.
 * The subscription is owned by the connection, so handler churn can never
 * unsubscribe the stream for the others.
 *
 * Only activated when mqtt.enabled=true (default true) so tests can disable it
 * without a running broker.
 */
@Slf4j
@Component
@ConditionalOnProperty(name = "mqtt.enabled", havingValue = "true", matchIfMissing = true)
public class MqttConnection {

    private static final String CATCH_ALL_TOPIC = "#";

    private final MqttProperties props;
    private volatile MqttAsyncClient client;
    private volatile String connectionError = null;

    /** Message handlers: handler key → consumer of (topic, message). */
    private final ConcurrentHashMap<String, BiConsumer<String, MqttMessage>> handlers = new ConcurrentHashMap<>();

    public MqttConnection(MqttProperties props) {
        this.props = props;
    }

    @EventListener(ApplicationReadyEvent.class)
    @Order(0)
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
                    try {
                        client.subscribe(CATCH_ALL_TOPIC, 0);
                        log.info("Subscribed to catch-all topic ({})", CATCH_ALL_TOPIC);
                    } catch (MqttException e) {
                        log.error("Failed to subscribe to {}: {}", CATCH_ALL_TOPIC, e.getMessage());
                    }
                }

                @Override
                public void messageArrived(String topic, MqttMessage message) {
                    for (var entry : handlers.entrySet()) {
                        try {
                            entry.getValue().accept(topic, message);
                        } catch (Exception e) {
                            log.warn("MQTT handler '{}' failed on topic {}: {}",
                                    entry.getKey(), topic, e.getMessage());
                        }
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

            log.info("MQTT connecting to {} (user={})...", props.getBrokerUrl(), props.getUsername());
            client.connect(options).waitForCompletion(15_000);
            log.info("MQTT connected successfully to {}", props.getBrokerUrl());

        } catch (MqttException e) {
            connectionError = "reason=" + e.getReasonCode() + " (" + e.getMessage() + ")";
            log.warn("Could not connect to MQTT broker at {}: {} — auto-reconnect will keep trying",
                    props.getBrokerUrl(), connectionError);
        }
    }

    /**
     * Register a message handler on the shared catch-all stream. Throws when
     * the broker is unreachable so interactive callers can surface the error.
     */
    public void registerHandler(String handlerKey, BiConsumer<String, MqttMessage> handler) throws MqttException {
        if (client != null && !client.isConnected()) {
            // Wait briefly in case the startup connect is still in progress
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

        handlers.put(handlerKey, handler);
        log.info("Registered MQTT handler '{}'", handlerKey);
    }

    public void unregisterHandler(String handlerKey) {
        handlers.remove(handlerKey);
        log.info("Unregistered MQTT handler '{}'", handlerKey);
    }

    public boolean isConnected() {
        return client != null && client.isConnected();
    }
}
