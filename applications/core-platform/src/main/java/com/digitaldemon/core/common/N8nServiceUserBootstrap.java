package com.digitaldemon.core.common;

import com.digitaldemon.core.common.config.N8nServiceAuthProperties;
import com.digitaldemon.core.user.GlobalRole;
import com.digitaldemon.core.user.User;
import com.digitaldemon.core.user.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;

/**
 * Ensures the dedicated n8n service user exists with the configured global role.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class N8nServiceUserBootstrap implements ApplicationRunner {

    private final UserRepository userRepository;
    private final N8nServiceAuthProperties properties;

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        if (!properties.isEnabled()) {
            log.debug("n8n service auth is disabled; skipping service-user bootstrap");
            return;
        }

        if (properties.getToken() == null || properties.getToken().isBlank()) {
            log.warn("n8n service auth is enabled but token is empty; skipping service-user bootstrap");
            return;
        }

        String auth0Sub = requireAuth0Sub();
        GlobalRole globalRole = resolveRole(properties.getGlobalRole());

        User user = userRepository.findByAuth0Sub(auth0Sub)
                .orElseGet(() -> {
                    User created = new User();
                    created.setAuth0Sub(auth0Sub);
                    created.setCreatedAt(Instant.now());
                    return created;
                });

        user.setEmail(blankToNull(properties.getEmail()));
        user.setDisplayName(blankToNull(properties.getDisplayName()));
        user.setGlobalRole(globalRole.getValue());
        user.setLastLoginAt(Instant.now());

        User saved = userRepository.save(user);
        log.info("n8n service user ready (id={}, sub={}, role={})",
                saved.getId(), saved.getAuth0Sub(), saved.getGlobalRole());
    }

    private String requireAuth0Sub() {
        String auth0Sub = blankToNull(properties.getAuth0Sub());
        if (auth0Sub == null) {
            throw new IllegalStateException("service-auth.n8n.auth0-sub must be configured when n8n service auth is enabled");
        }
        return auth0Sub;
    }

    private GlobalRole resolveRole(String configuredRole) {
        String roleValue = blankToNull(configuredRole);
        if (roleValue == null) {
            return GlobalRole.SYSTEM_ADMIN;
        }

        GlobalRole role = GlobalRole.fromValue(roleValue);
        if (role == GlobalRole.VIEWER && !"viewer".equalsIgnoreCase(roleValue)) {
            throw new IllegalStateException("Invalid service-auth.n8n.global-role: " + configuredRole);
        }
        return role;
    }

    private String blankToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
