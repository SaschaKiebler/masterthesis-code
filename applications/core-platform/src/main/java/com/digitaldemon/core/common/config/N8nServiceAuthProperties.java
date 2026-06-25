package com.digitaldemon.core.common.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * Configuration for static bearer-token access used by n8n automation.
 */
@Data
@Component
@ConfigurationProperties(prefix = "service-auth.n8n")
public class N8nServiceAuthProperties {

    private boolean enabled = false;
    private String token = "";
    private String auth0Sub = "service:n8n";
    private String email = "n8n@digitaldemon.local";
    private String displayName = "n8n Service User";
    private String globalRole = "system_admin";
}
