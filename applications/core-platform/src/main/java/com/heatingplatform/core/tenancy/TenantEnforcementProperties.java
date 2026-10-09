package com.heatingplatform.core.tenancy;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * The kill switch, read per request rather than captured statically so a bad
 * rollout is one environment change plus a restart away from being undone.
 */
@Component
@ConfigurationProperties(prefix = "tenant.enforcement")
@Getter
@Setter
public class TenantEnforcementProperties {

    public enum Mode {
        /** The interceptor does nothing at all. */
        OFF,
        /**
         * Resolve and record, never block. The deployment stage that closes the
         * audit blind spot on its own, and the soft position of the kill switch.
         */
        OBSERVE,
        /** Resolve, record and refuse cross-tenant access with 403. */
        ENFORCE
    }

    private Mode mode = Mode.ENFORCE;

    public boolean isOff() {
        return mode == Mode.OFF;
    }

    public boolean isEnforcing() {
        return mode == Mode.ENFORCE;
    }
}
