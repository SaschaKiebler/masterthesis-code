package com.heatingplatform.core.tenant;

import com.heatingplatform.core.user.User;
import com.heatingplatform.core.user.UserTenantRole;
import com.heatingplatform.core.user.TenantRole;
import com.heatingplatform.core.user.GlobalRole;
import com.heatingplatform.core.common.exception.ResourceNotFoundException;
import com.heatingplatform.core.common.exception.ValidationException;
import com.heatingplatform.core.user.UserRepository;
import com.heatingplatform.core.user.UserTenantRoleRepository;
import com.heatingplatform.core.user.AuthService;
import com.heatingplatform.core.invitation.Invitation;
import com.heatingplatform.core.invitation.InvitationService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Tenant management endpoints (ADR-009).
 * Only consultants and system admins can create/manage tenants.
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/tenants")
@RequiredArgsConstructor
public class TenantController {

    private final TenantRepository tenantRepository;
    private final UserRepository userRepository;
    private final UserTenantRoleRepository userTenantRoleRepository;
    private final AuthService authService;
    private final InvitationService invitationService;

    /**
     * GET /api/v1/tenants — List all tenants the current user can access.
     */
    @GetMapping
    public ResponseEntity<Map<String, Object>> listTenants() {
        log.info("REST GET /api/v1/tenants");

        List<Tenant> tenants;
        if (authService.isSystemAdmin()) {
            tenants = tenantRepository.findAll();
        } else {
            List<UUID> tenantIds = authService.getAccessibleTenantIds();
            tenants = tenantIds.isEmpty() ? List.of() : tenantRepository.findAllById(tenantIds);
        }

        List<Map<String, Object>> result = tenants.stream()
            .map(this::toMap)
            .collect(Collectors.toList());

        return ResponseEntity.ok(Map.of("tenants", result));
    }

    /**
     * GET /api/v1/tenants/{id} — Get a single tenant.
     */
    @GetMapping("/{id}")
    public ResponseEntity<Map<String, Object>> getTenant(@PathVariable String id) {
        log.info("REST GET /api/v1/tenants/{}", id);

        UUID tenantId = UUID.fromString(id);
        if (!authService.canAccessTenant(tenantId)) {
            return ResponseEntity.status(403).body(Map.of("message", "Access denied to tenant"));
        }

        Tenant tenant = tenantRepository.findById(tenantId)
            .orElseThrow(() -> new ResourceNotFoundException("Tenant", tenantId));

        // Include members if user is manager or above
        Map<String, Object> response = new HashMap<>();
        response.put("tenant", toMap(tenant));

        if (authService.isManagerInTenant(tenantId)) {
            List<UserTenantRole> members = userTenantRoleRepository.findByTenantId(tenantId);
            List<Map<String, Object>> memberList = members.stream()
                .map(utr -> {
                    Map<String, Object> m = new HashMap<>();
                    m.put("userId", utr.getUser().getId().toString());
                    m.put("email", utr.getUser().getEmail());
                    m.put("displayName", utr.getUser().getDisplayName());
                    m.put("globalRole", utr.getUser().getGlobalRole());
                    m.put("tenantRole", utr.getTenantRole());
                    return m;
                })
                .toList();
            response.put("members", memberList);
        }

        return ResponseEntity.ok(response);
    }

    /**
     * POST /api/v1/tenants — Create a new tenant.
     * Only consultants and system admins. The creator becomes 'manager' in the new tenant.
     */
    @PostMapping
    public ResponseEntity<Map<String, Object>> createTenant(@RequestBody Map<String, Object> body) {
        log.info("REST POST /api/v1/tenants");

        if (!authService.isConsultantOrAdmin()) {
            return ResponseEntity.status(403)
                .body(Map.of("message", "Only consultants and admins can create tenants"));
        }

        String name = (String) body.get("name");
        if (name == null || name.isBlank()) {
            throw new ValidationException("Tenant name must not be empty");
        }

        User currentUser = authService.getOrProvisionCurrentUser();

        Tenant tenant = new Tenant();
        tenant.setName(name);
        tenant.setCreatedBy(currentUser.getId());
        tenant.setType((String) body.getOrDefault("type", "standard"));
        tenant.setStatus("active");
        tenant.setConfig(body.containsKey("config") ? (String) body.get("config") : "{}");
        tenant.setCreatedAt(Instant.now());
        tenant.setUpdatedAt(Instant.now());

        Tenant saved = tenantRepository.save(tenant);

        // Auto-assign the creator as 'manager'
        authService.addUserToTenant(currentUser, saved, TenantRole.MANAGER);

        log.info("Created tenant: {} (id: {}) by user: {}", saved.getName(), saved.getId(), currentUser.getId());

        return ResponseEntity.status(201).body(Map.of("tenant", toMap(saved)));
    }

    /**
     * PATCH /api/v1/tenants/{id} — Update a tenant.
     * Requires manager role in the tenant.
     */
    @PatchMapping("/{id}")
    public ResponseEntity<Map<String, Object>> updateTenant(
            @PathVariable String id,
            @RequestBody Map<String, Object> body) {
        log.info("REST PATCH /api/v1/tenants/{}", id);

        UUID tenantId = UUID.fromString(id);
        if (!authService.isManagerInTenant(tenantId)) {
            return ResponseEntity.status(403).body(Map.of("message", "Manager role required"));
        }

        Tenant tenant = tenantRepository.findById(tenantId)
            .orElseThrow(() -> new ResourceNotFoundException("Tenant", tenantId));

        if (body.containsKey("name")) tenant.setName((String) body.get("name"));
        if (body.containsKey("config")) tenant.setConfig((String) body.get("config"));
        if (body.containsKey("status") && authService.isSystemAdmin()) {
            tenant.setStatus((String) body.get("status"));
        }
        tenant.setUpdatedAt(Instant.now());

        Tenant saved = tenantRepository.save(tenant);
        return ResponseEntity.ok(Map.of("tenant", toMap(saved)));
    }

    /**
     * POST /api/v1/tenants/with-invitation — Create a tenant and invite a consultant in one step.
     * System admin only.
     */
    @PostMapping("/with-invitation")
    @Transactional
    public ResponseEntity<Map<String, Object>> createTenantWithInvitation(@RequestBody Map<String, Object> body) {
        log.info("REST POST /api/v1/tenants/with-invitation");

        if (!authService.isSystemAdmin()) {
            return ResponseEntity.status(403)
                .body(Map.of("message", "System admin role required"));
        }

        String name = (String) body.get("name");
        if (name == null || name.isBlank()) {
            throw new ValidationException("Tenant name must not be empty");
        }

        String consultantEmail = (String) body.get("consultantEmail");
        if (consultantEmail == null || consultantEmail.isBlank()) {
            throw new ValidationException("Consultant email is required");
        }

        String consultantTenantRole = (String) body.getOrDefault("consultantTenantRole", "manager");
        String consultantGlobalRole = (String) body.getOrDefault("consultantGlobalRole", "consultant");

        User currentUser = authService.getOrProvisionCurrentUser();

        // 1. Create tenant
        Tenant tenant = new Tenant();
        tenant.setName(name);
        tenant.setCreatedBy(currentUser.getId());
        tenant.setType((String) body.getOrDefault("type", "standard"));
        tenant.setStatus("active");
        tenant.setConfig("{}");
        tenant.setCreatedAt(Instant.now());
        tenant.setUpdatedAt(Instant.now());
        Tenant saved = tenantRepository.save(tenant);

        // 2. Auto-assign system_admin as MANAGER in new tenant
        authService.addUserToTenant(currentUser, saved, TenantRole.MANAGER);

        // 3. Create invitation for consultant
        Invitation invitation = invitationService.createInvitation(
                consultantEmail, saved.getId(), consultantTenantRole, consultantGlobalRole);

        log.info("Created tenant {} with invitation for {}", saved.getId(), consultantEmail);

        Map<String, Object> invMap = new HashMap<>();
        invMap.put("id", invitation.getId().toString());
        invMap.put("email", invitation.getEmail());
        invMap.put("token", invitation.getToken());
        invMap.put("expiresAt", invitation.getExpiresAt().toString());

        return ResponseEntity.status(201).body(Map.of(
                "tenant", toMap(saved),
                "invitation", invMap
        ));
    }

    // ── Member Management ─────────────────────────────────────────────

    /**
     * GET /api/v1/tenants/{id}/members — List members of a tenant.
     */
    @GetMapping("/{id}/members")
    public ResponseEntity<Map<String, Object>> listMembers(@PathVariable String id) {
        log.info("REST GET /api/v1/tenants/{}/members", id);

        UUID tenantId = UUID.fromString(id);
        if (!authService.isManagerInTenant(tenantId)) {
            return ResponseEntity.status(403).body(Map.of("message", "Manager role required"));
        }

        tenantRepository.findById(tenantId)
            .orElseThrow(() -> new ResourceNotFoundException("Tenant", tenantId));

        List<UserTenantRole> members = userTenantRoleRepository.findByTenantId(tenantId);
        List<Map<String, Object>> memberList = members.stream()
            .map(this::toMemberMap)
            .toList();

        return ResponseEntity.ok(Map.of("members", memberList));
    }

    /**
     * POST /api/v1/tenants/{id}/members — Add a user to a tenant.
     */
    @PostMapping("/{id}/members")
    public ResponseEntity<Map<String, Object>> addMember(
            @PathVariable String id,
            @RequestBody Map<String, Object> body) {

        log.info("REST POST /api/v1/tenants/{}/members", id);

        UUID tenantId = UUID.fromString(id);
        if (!authService.isManagerInTenant(tenantId)) {
            return ResponseEntity.status(403).body(Map.of("message", "Manager role required"));
        }

        String userIdStr = (String) body.get("userId");
        String roleStr = (String) body.getOrDefault("tenantRole", "viewer");
        if (userIdStr == null || userIdStr.isBlank()) {
            throw new ValidationException("userId is required");
        }

        UUID userId = UUID.fromString(userIdStr);
        Tenant tenant = tenantRepository.findById(tenantId)
            .orElseThrow(() -> new ResourceNotFoundException("Tenant", tenantId));
        User user = userRepository.findById(userId)
            .orElseThrow(() -> new ResourceNotFoundException("User", userId));

        // Check if already a member
        if (userTenantRoleRepository.findByUserIdAndTenantId(userId, tenantId).isPresent()) {
            return ResponseEntity.status(409)
                .body(Map.of("message", "User is already a member of this tenant"));
        }

        TenantRole role = TenantRole.fromValue(roleStr);
        UserTenantRole utr = authService.addUserToTenant(user, tenant, role);

        log.info("Added user {} to tenant {} with role {}", userId, tenantId, role.getValue());

        return ResponseEntity.status(201).body(Map.of("member", toMemberMap(utr)));
    }

    /**
     * PATCH /api/v1/tenants/{id}/members/{userId} — Change a member's tenant role.
     */
    @PatchMapping("/{id}/members/{userId}")
    public ResponseEntity<Map<String, Object>> updateMemberRole(
            @PathVariable String id,
            @PathVariable String userId,
            @RequestBody Map<String, Object> body) {

        log.info("REST PATCH /api/v1/tenants/{}/members/{}", id, userId);

        UUID tenantId = UUID.fromString(id);
        UUID memberUserId = UUID.fromString(userId);

        if (!authService.isManagerInTenant(tenantId)) {
            return ResponseEntity.status(403).body(Map.of("message", "Manager role required"));
        }

        UserTenantRole utr = userTenantRoleRepository.findByUserIdAndTenantId(memberUserId, tenantId)
            .orElseThrow(() -> new ResourceNotFoundException("User is not a member of this tenant"));

        String roleStr = (String) body.get("tenantRole");
        if (roleStr == null || roleStr.isBlank()) {
            throw new ValidationException("tenantRole is required");
        }

        utr.setTenantRoleEnum(TenantRole.fromValue(roleStr));
        UserTenantRole saved = userTenantRoleRepository.save(utr);

        log.info("Updated tenant role for user {} in tenant {} to {}", memberUserId, tenantId, roleStr);

        return ResponseEntity.ok(Map.of("member", toMemberMap(saved)));
    }

    /**
     * DELETE /api/v1/tenants/{id}/members/{userId} — Remove a member from a tenant.
     * Cannot remove the last manager.
     */
    @DeleteMapping("/{id}/members/{userId}")
    public ResponseEntity<Map<String, Object>> removeMember(
            @PathVariable String id,
            @PathVariable String userId) {

        log.info("REST DELETE /api/v1/tenants/{}/members/{}", id, userId);

        UUID tenantId = UUID.fromString(id);
        UUID memberUserId = UUID.fromString(userId);

        if (!authService.isManagerInTenant(tenantId)) {
            return ResponseEntity.status(403).body(Map.of("message", "Manager role required"));
        }

        UserTenantRole utr = userTenantRoleRepository.findByUserIdAndTenantId(memberUserId, tenantId)
            .orElseThrow(() -> new ResourceNotFoundException("User is not a member of this tenant"));

        // Prevent removing the last manager
        if (utr.getTenantRoleEnum().isAtLeast(TenantRole.MANAGER)) {
            long managerCount = userTenantRoleRepository.findByTenantId(tenantId).stream()
                .filter(r -> r.getTenantRoleEnum().isAtLeast(TenantRole.MANAGER))
                .count();
            if (managerCount <= 1) {
                return ResponseEntity.status(409)
                    .body(Map.of("message", "Cannot remove the last manager from a tenant"));
            }
        }

        userTenantRoleRepository.delete(utr);
        log.info("Removed user {} from tenant {}", memberUserId, tenantId);

        return ResponseEntity.ok(Map.of("message", "Member removed"));
    }

    // ── Mappers ──────────────────────────────────────────────────────────

    private Map<String, Object> toMemberMap(UserTenantRole utr) {
        Map<String, Object> m = new HashMap<>();
        m.put("userId", utr.getUser().getId().toString());
        m.put("email", utr.getUser().getEmail());
        m.put("displayName", utr.getUser().getDisplayName());
        m.put("avatarUrl", utr.getUser().getAvatarUrl());
        m.put("globalRole", utr.getUser().getGlobalRole());
        m.put("tenantRole", utr.getTenantRole());
        m.put("joinedAt", utr.getCreatedAt() != null ? utr.getCreatedAt().toString() : null);
        return m;
    }

    private Map<String, Object> toMap(Tenant tenant) {
        Map<String, Object> map = new HashMap<>();
        map.put("id", tenant.getId().toString());
        map.put("name", tenant.getName());
        map.put("type", tenant.getType());
        map.put("status", tenant.getStatus());
        map.put("createdBy", tenant.getCreatedBy() != null ? tenant.getCreatedBy().toString() : null);
        map.put("createdAt", tenant.getCreatedAt() != null ? tenant.getCreatedAt().toString() : null);
        return map;
    }
}
