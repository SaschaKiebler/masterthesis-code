package com.heatingplatform.core.user;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;

/**
 * Seeds the bootstrap admin account for local authentication so the platform
 * is usable without any external identity provider.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class LocalAdminBootstrap implements ApplicationRunner {

    private final UserRepository userRepository;
    private final LocalAuthProperties properties;
    private final PasswordEncoder passwordEncoder;

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        String email = properties.getAdminEmail().trim().toLowerCase();

        User admin = userRepository.findByEmail(email).orElseGet(() -> {
            User created = new User();
            created.setSubject("local|" + email);
            created.setEmail(email);
            created.setDisplayName(properties.getAdminDisplayName());
            created.setGlobalRole(GlobalRole.SYSTEM_ADMIN.getValue());
            created.setCreatedAt(Instant.now());
            log.warn("Seeding local admin account '{}' with the configured default password — "
                    + "change LOCAL_AUTH_ADMIN_PASSWORD for anything beyond local use", email);
            return created;
        });

        if (admin.getPasswordHash() == null) {
            admin.setPasswordHash(passwordEncoder.encode(properties.getAdminPassword()));
            userRepository.save(admin);
            log.info("Local admin account ready (email={})", email);
        }
    }
}
