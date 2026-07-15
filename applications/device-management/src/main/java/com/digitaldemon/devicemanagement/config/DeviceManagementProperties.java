package com.digitaldemon.devicemanagement.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Data
@Component
@ConfigurationProperties(prefix = "device-management")
public class DeviceManagementProperties {

    private Topics topics = new Topics();
    private Projection projection = new Projection();
    private Watcher watcher = new Watcher();
    private Discovery discovery = new Discovery();

    @Data
    public static class Topics {
        /** Compacted desired-config topic, key = device_id. */
        private String deviceConfigured = "device.configured";
        /** Unknown-device event topic. */
        private String deviceDiscovered = "device.discovered";
        private int partitions = 3;
        private int replicas = 1;
    }

    @Data
    public static class Projection {
        private long sweepIntervalMs = 30_000;
    }

    @Data
    public static class Watcher {
        private int discoveredThrottleMinutes = 10;
        private int samplePayloadMaxChars = 512;
    }

    @Data
    public static class Discovery {
        private boolean enabled = true;
        private int maxSessionsPerTenant = 3;
        private int sessionTimeoutSeconds = 300;
        private int maxMessagesPerSession = 500;
    }
}
