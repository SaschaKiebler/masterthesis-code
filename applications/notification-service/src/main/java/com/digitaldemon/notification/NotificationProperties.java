package com.digitaldemon.notification;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.util.List;

@Data
@Component
@ConfigurationProperties(prefix = "notification")
public class NotificationProperties {

    /** Detection-event topics to consume. */
    private List<String> topics = List.of("threshold.breached");

    private Policy policy = new Policy();
    private Webhook webhook = new Webhook();
    private TopicDefaults topicDefaults = new TopicDefaults();

    @Data
    public static class Policy {
        /** Minimum severity to deliver: INFO | WARNING | ERROR | CRITICAL. */
        private String minSeverity = "INFO";
        /** Dedup window per (type, device, metric); 0 = off. */
        private int cooldownMinutes = 0;
    }

    @Data
    public static class Webhook {
        /** POST target; empty = log-only delivery. */
        private String url = "";
        /** Optional bearer token sent as Authorization header. */
        private String token = "";
    }

    @Data
    public static class TopicDefaults {
        private int partitions = 3;
        private int replicas = 1;
    }
}
