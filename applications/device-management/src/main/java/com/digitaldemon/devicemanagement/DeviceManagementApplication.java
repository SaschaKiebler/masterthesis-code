package com.digitaldemon.devicemanagement;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * Device-management service: owns the broker-facing device lifecycle.
 *
 * Responsibilities (see docs/architecture/event-catalog.md):
 * - watches the MQTT broker and publishes `device.discovered` for devices
 *   without configuration
 * - publishes the desired per-device config as a compacted `device.configured`
 *   topic, which the ingestion service consumes instead of polling the DB
 * - hosts interactive discovery (payload sniffing) sessions, proxied by
 *   core-platform for the UI
 */
@SpringBootApplication
@EnableScheduling
public class DeviceManagementApplication {

    public static void main(String[] args) {
        SpringApplication.run(DeviceManagementApplication.class, args);
    }
}
