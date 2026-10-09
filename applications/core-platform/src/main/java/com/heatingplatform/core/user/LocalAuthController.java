package com.heatingplatform.core.user;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

/**
 * Local login endpoint. Replaces the former Auth0 integration with a simple
 * email + password login that returns a self-issued HS256 access token.
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/auth")
@RequiredArgsConstructor
public class LocalAuthController {

    private final UserRepository userRepository;
    private final LocalTokenService tokenService;
    private final PasswordEncoder passwordEncoder;

    /**
     * POST /api/v1/auth/login — Authenticate with email and password.
     * Returns an access token plus the user profile.
     */
    @PostMapping("/login")
    @Transactional
    public ResponseEntity<Map<String, Object>> login(@RequestBody Map<String, Object> body) {
        String email = body.get("email") instanceof String s ? s.trim().toLowerCase() : null;
        String password = body.get("password") instanceof String s ? s : null;

        if (email == null || email.isBlank() || password == null || password.isBlank()) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                    .body(Map.of("error", "Email and password are required"));
        }

        log.info("REST POST /api/v1/auth/login ({})", email);

        Optional<User> found = userRepository.findByEmail(email);
        if (found.isEmpty()
                || found.get().getPasswordHash() == null
                || !passwordEncoder.matches(password, found.get().getPasswordHash())) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(Map.of("error", "Invalid email or password"));
        }

        User user = found.get();
        user.setLastLoginAt(Instant.now());
        userRepository.save(user);

        return ResponseEntity.ok(Map.of(
                "token", tokenService.issueToken(user),
                "user", buildUserMap(user)
        ));
    }

    private Map<String, Object> buildUserMap(User user) {
        Map<String, Object> profile = new HashMap<>();
        profile.put("id", user.getId().toString());
        profile.put("email", user.getEmail());
        profile.put("displayName", user.getDisplayName());
        profile.put("avatarUrl", user.getAvatarUrl());
        profile.put("globalRole", user.getGlobalRole());
        return profile;
    }
}
