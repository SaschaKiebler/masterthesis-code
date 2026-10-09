package com.heatingplatform.core.common.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * Application-level Kafka settings (topic names and provisioning defaults).
 * Broker connection settings live under the standard {@code spring.kafka.*}
 * properties in application.yml.
 */
@Data
@Component
@ConfigurationProperties(prefix = "kafka")
public class KafkaTopicsProperties {

    /** Master switch so tests can run without a broker (mirrors mqtt.enabled). */
    private boolean enabled = true;

    private Topics topics = new Topics();
    private TopicDefaults topicDefaults = new TopicDefaults();

    @Data
    public static class Topics {
        /** Processed measurement batches from the ingestion service. */
        private String measurementIngested = "measurement.ingested";
        /** Unknown-device events from device-management (topic owned there). */
        private String deviceDiscovered = "device.discovered";
        /** Threshold detections from the analytics evaluator (topic owned there). */
        private String thresholdBreached = "threshold.breached";
        /** Weather-contextual anomaly detections from analytics (topic owned there). */
        private String anomalyDetected = "anomaly.detected";
        /** Compacted detection-rule projection, published and owned by core. */
        private String ruleConfigured = "rule.configured";
        /** Compacted anomaly-rule projection, published and owned by core. */
        private String anomalyRuleConfigured = "anomaly-rule.configured";
    }

    @Data
    public static class TopicDefaults {
        private int partitions = 3;
        private int replicas = 1;
    }
}
