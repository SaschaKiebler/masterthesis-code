package com.digitaldemon.core.common.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Data
@Component
@ConfigurationProperties(prefix = "mqtt")
public class MqttProperties {
    private String brokerUrl = "tcp://localhost:1883";
    private String clientId  = "core-platform";
    private String username  = "";
    private String password  = "";
    private boolean enabled  = true;
}
