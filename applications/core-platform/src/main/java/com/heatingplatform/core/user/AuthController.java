package com.heatingplatform.core.user;

import com.heatingplatform.core.user.User;
import com.heatingplatform.core.user.UserTenantRole;
import com.heatingplatform.core.user.AuthService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Endpoints for the authenticated user's profile and authorization context.
 */
@Slf4j
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;

    /**
     * GET /api/v1/me — Returns the current user's profile, global role, and tenant memberships.
     * The frontend calls this after login to build the auth context.
     */
    @GetMapping("/me")
    public ResponseEntity<Map<String, Object>> getCurrentUser() {
        log.info("REST GET /api/v1/me");

        User user;
        try {
            user = authService.getOrProvisionCurrentUser();
        } catch (SecurityException e) {
            log.warn("Unauthenticated request to /me: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Not authenticated"));
        }
        List<UserTenantRole> tenantRoles = authService.getCurrentUserTenantRoles();

        return ResponseEntity.ok(Map.of(
            "user", buildUserMap(user),
            "tenants", buildTenantsList(tenantRoles)
        ));
    }

    /**
     * PATCH /api/v1/me — Update the current user's profile.
     * Accepts: displayName, email, avatarUrl.
     * Users can always update their own displayName.
     * Email and avatarUrl are synced on login.
     */
    @PatchMapping("/me")
    public ResponseEntity<Map<String, Object>> updateCurrentUser(@RequestBody Map<String, Object> body) {
        log.info("REST PATCH /api/v1/me");

        User user;
        try {
            user = authService.getOrProvisionCurrentUser();
        } catch (SecurityException e) {
            log.warn("Unauthenticated request to PATCH /me: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Not authenticated"));
        }

        if (body.containsKey("displayName")) {
            Object name = body.get("displayName");
            if (name instanceof String s && !s.isBlank()) {
                user.setDisplayName(s.trim());
            }
        }
        if (body.containsKey("email")) {
            Object email = body.get("email");
            if (email instanceof String s && !s.isBlank()) {
                user.setEmail(s.trim().toLowerCase());
            }
        }
        if (body.containsKey("avatarUrl")) {
            Object avatar = body.get("avatarUrl");
            if (avatar instanceof String s && !s.isBlank()) {
                user.setAvatarUrl(s.trim());
            }
        }

        user = authService.saveUser(user);
        List<UserTenantRole> tenantRoles = authService.getCurrentUserTenantRoles();

        return ResponseEntity.ok(Map.of(
            "user", buildUserMap(user),
            "tenants", buildTenantsList(tenantRoles)
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

    private List<Map<String, Object>> buildTenantsList(List<UserTenantRole> tenantRoles) {
        return tenantRoles.stream()
            .map(utr -> {
                Map<String, Object> t = new HashMap<>();
                t.put("id", utr.getTenant().getId().toString());
                t.put("name", utr.getTenant().getName());
                t.put("tenantRole", utr.getTenantRole());
                return t;
            })
            .toList();
    }
}
