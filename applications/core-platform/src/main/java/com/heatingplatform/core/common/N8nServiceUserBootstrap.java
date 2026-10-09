package com.heatingplatform.core.common;

import com.heatingplatform.core.common.config.N8nServiceAuthProperties;
import com.heatingplatform.core.user.GlobalRole;
import com.heatingplatform.core.user.User;
import com.heatingplatform.core.user.UserRepository;
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

        String subject = requireSubject();
        GlobalRole globalRole = resolveRole(properties.getGlobalRole());

        User user = userRepository.findBySubject(subject)
                .orElseGet(() -> {
                    User created = new User();
                    created.setSubject(subject);
                    created.setCreatedAt(Instant.now());
                    return created;
                });

        user.setEmail(blankToNull(properties.getEmail()));
        user.setDisplayName(blankToNull(properties.getDisplayName()));
        user.setGlobalRole(globalRole.getValue());
        user.setLastLoginAt(Instant.now());

        User saved = userRepository.save(user);
        log.info("n8n service user ready (id={}, sub={}, role={})",
                saved.getId(), saved.getSubject(), saved.getGlobalRole());
    }

    private String requireSubject() {
        String subject = blankToNull(properties.getSubject());
        if (subject == null) {
            throw new IllegalStateException("service-auth.n8n.subject must be configured when n8n service auth is enabled");
        }
        return subject;
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
