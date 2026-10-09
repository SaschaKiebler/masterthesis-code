package com.heatingplatform.core.user;

import com.heatingplatform.core.user.GlobalRole;
import com.heatingplatform.core.user.User;
import com.heatingplatform.core.user.UserTenantRole;
import com.heatingplatform.core.common.exception.ResourceNotFoundException;
import com.heatingplatform.core.common.exception.ValidationException;
import com.heatingplatform.core.user.UserRepository;
import com.heatingplatform.core.user.UserTenantRoleRepository;
import com.heatingplatform.core.user.AuthService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;

/**
 * User management endpoints (ADR-009).
 * Only system_admin can access these endpoints.
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/users")
@RequiredArgsConstructor
public class UserController {

    private final UserRepository userRepository;
    private final UserTenantRoleRepository userTenantRoleRepository;
    private final AuthService authService;

    /**
     * GET /api/v1/users — List all platform users with pagination.
     */
    @GetMapping
    public ResponseEntity<Map<String, Object>> listUsers(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(required = false) String role,
            @RequestParam(required = false) String search) {

        log.info("REST GET /api/v1/users (page={}, pageSize={}, role={}, search={})", page, pageSize, role, search);

        if (!authService.isSystemAdmin()) {
            return ResponseEntity.status(403).body(Map.of("message", "System admin role required"));
        }

        PageRequest pageable = PageRequest.of(
                Math.max(0, page - 1), Math.min(pageSize, 100),
                Sort.by(Sort.Direction.DESC, "createdAt")
        );

        Page<User> userPage;
        if (search != null && !search.isBlank()) {
            userPage = userRepository.searchByEmailOrDisplayName(search.trim(), pageable);
        } else if (role != null && !role.isBlank()) {
            userPage = userRepository.findByGlobalRole(role.trim(), pageable);
        } else {
            userPage = userRepository.findAll(pageable);
        }

        List<Map<String, Object>> users = userPage.getContent().stream()
                .map(this::toUserSummary)
                .toList();

        return ResponseEntity.ok(Map.of(
                "users", users,
                "page", Map.of(
                        "totalItems", userPage.getTotalElements(),
                        "totalPages", userPage.getTotalPages(),
                        "currentPage", page,
                        "pageSize", pageSize
                )
        ));
    }

    /**
     * GET /api/v1/users/{id} — Get user detail including tenant memberships.
     */
    @GetMapping("/{id}")
    public ResponseEntity<Map<String, Object>> getUser(@PathVariable String id) {
        log.info("REST GET /api/v1/users/{}", id);

        if (!authService.isSystemAdmin()) {
            return ResponseEntity.status(403).body(Map.of("message", "System admin role required"));
        }

        UUID userId = UUID.fromString(id);
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User", userId));

        List<UserTenantRole> tenantRoles = userTenantRoleRepository.findByUserId(userId);

        Map<String, Object> response = new HashMap<>(toUserSummary(user));
        response.put("subject", user.getSubject());

        List<Map<String, Object>> tenants = tenantRoles.stream()
                .map(utr -> {
                    Map<String, Object> t = new HashMap<>();
                    t.put("tenantId", utr.getTenant().getId().toString());
                    t.put("tenantName", utr.getTenant().getName());
                    t.put("tenantRole", utr.getTenantRole());
                    t.put("joinedAt", utr.getCreatedAt() != null ? utr.getCreatedAt().toString() : null);
                    return t;
                })
                .toList();
        response.put("tenants", tenants);

        return ResponseEntity.ok(Map.of("user", response));
    }

    /**
     * PATCH /api/v1/users/{id} — Update a user's global role.
     * Cannot change own role (self-escalation prevention).
     */
    @PatchMapping("/{id}")
    public ResponseEntity<Map<String, Object>> updateUser(
            @PathVariable String id,
            @RequestBody Map<String, Object> body) {

        log.info("REST PATCH /api/v1/users/{}", id);

        if (!authService.isSystemAdmin()) {
            return ResponseEntity.status(403).body(Map.of("message", "System admin role required"));
        }

        UUID userId = UUID.fromString(id);
        User currentUser = authService.getOrProvisionCurrentUser();

        if (currentUser.getId().equals(userId)) {
            return ResponseEntity.status(403)
                    .body(Map.of("message", "Cannot change your own global role"));
        }

        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User", userId));

        if (body.containsKey("globalRole")) {
            String roleValue = (String) body.get("globalRole");
            GlobalRole newRole = GlobalRole.fromValue(roleValue);
            if (newRole == GlobalRole.VIEWER && !"viewer".equalsIgnoreCase(roleValue)) {
                throw new ValidationException("Invalid global role: " + roleValue);
            }
            log.info("Changing global role for user {} from {} to {}", userId, user.getGlobalRole(), newRole.getValue());
            user.setGlobalRoleEnum(newRole);
        }

        if (body.containsKey("displayName")) {
            user.setDisplayName((String) body.get("displayName"));
        }

        User saved = userRepository.save(user);
        return ResponseEntity.ok(Map.of("user", toUserSummary(saved)));
    }

    /**
     * DELETE /api/v1/users/{id} — Deactivate a user.
     * Sets global_role to 'viewer' and removes all tenant memberships.
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String, Object>> deleteUser(@PathVariable String id) {
        log.info("REST DELETE /api/v1/users/{}", id);

        if (!authService.isSystemAdmin()) {
            return ResponseEntity.status(403).body(Map.of("message", "System admin role required"));
        }

        UUID userId = UUID.fromString(id);
        User currentUser = authService.getOrProvisionCurrentUser();

        if (currentUser.getId().equals(userId)) {
            return ResponseEntity.status(403)
                    .body(Map.of("message", "Cannot delete your own account"));
        }

        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User", userId));

        // Remove all tenant memberships
        List<UserTenantRole> roles = userTenantRoleRepository.findByUserId(userId);
        userTenantRoleRepository.deleteAll(roles);

        // Reset to viewer (soft-delete)
        user.setGlobalRoleEnum(GlobalRole.VIEWER);
        userRepository.save(user);

        log.info("Deactivated user {} (removed {} tenant memberships)", userId, roles.size());

        return ResponseEntity.ok(Map.of("message", "User deactivated"));
    }

    private Map<String, Object> toUserSummary(User user) {
        Map<String, Object> map = new HashMap<>();
        map.put("id", user.getId().toString());
        map.put("email", user.getEmail());
        map.put("displayName", user.getDisplayName());
        map.put("avatarUrl", user.getAvatarUrl());
        map.put("globalRole", user.getGlobalRole());
        map.put("lastLoginAt", user.getLastLoginAt() != null ? user.getLastLoginAt().toString() : null);
        map.put("createdAt", user.getCreatedAt() != null ? user.getCreatedAt().toString() : null);
        map.put("tenantCount", user.getTenantRoles() != null ? user.getTenantRoles().size() : 0);
        return map;
    }
}
