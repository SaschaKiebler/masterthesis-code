package com.heatingplatform.core.user;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * Configuration for the local authentication setup (self-issued HS256 JWTs).
 */
@Data
@Component
@ConfigurationProperties(prefix = "local-auth")
public class LocalAuthProperties {

    /** Secret used to sign and verify access tokens. Override in any non-local deployment. */
    private String jwtSecret = "insecure-local-dev-secret-change-me";

    /** Access token lifetime in hours. */
    private long tokenTtlHours = 24;

    /** Issuer claim written into and expected on self-issued tokens. */
    private String issuer = "core-platform";

    /** Bootstrap admin account, created on startup if it does not exist. */
    private String adminEmail = "admin@local";
    private String adminPassword = "admin";
    private String adminDisplayName = "Local Admin";
}
