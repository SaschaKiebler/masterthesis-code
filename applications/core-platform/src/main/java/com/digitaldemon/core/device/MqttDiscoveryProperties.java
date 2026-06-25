package com.digitaldemon.core.device;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Data
@Component
@ConfigurationProperties(prefix = "mqtt.discovery")
public class MqttDiscoveryProperties {
    private boolean enabled = true;
    private int maxSessionsPerTenant = 3;
    private int sessionTimeoutSeconds = 300;
    private int maxMessagesPerSession = 500;
    private String clientIdPrefix = "core-platform-discovery";
}
