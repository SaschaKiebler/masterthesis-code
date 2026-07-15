package com.digitaldemon.notification;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Notification service: the fan-out side of detection
 * (see docs/architecture/event-catalog.md, "Alerting, detection and
 * notification are separate").
 *
 * Consumes detection events (threshold.breached today; anomaly.detected and
 * maintenance.predicted slot onto the same envelope later), applies
 * notification policy (severity filter, dedup window), and delivers to
 * channels (webhook, e.g. n8n, and structured log). Adding a detector never
 * touches this service beyond the topic list.
 */
@SpringBootApplication
public class NotificationApplication {

    public static void main(String[] args) {
        SpringApplication.run(NotificationApplication.class, args);
    }
}
