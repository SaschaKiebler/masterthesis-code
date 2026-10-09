package com.heatingplatform.core.invitation;

import com.heatingplatform.core.invitation.Invitation;
import com.heatingplatform.core.common.exception.ResourceNotFoundException;
import com.heatingplatform.core.invitation.InvitationRepository;
import com.heatingplatform.core.tenant.TenantRepository;
import com.heatingplatform.core.user.AuthService;
import com.heatingplatform.core.invitation.InvitationService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;
import java.util.stream.Collectors;

/**
 * Invitation management endpoints (ADR-009).
 * Consultants and system admins can create/manage invitations.
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/invitations")
@RequiredArgsConstructor
public class InvitationController {

    private final InvitationRepository invitationRepository;
    private final TenantRepository tenantRepository;
    private final InvitationService invitationService;
    private final AuthService authService;

    /**
     * GET /api/v1/invitations — List invitations.
     * Filterable by tenantId and status.
     */
    @GetMapping
    public ResponseEntity<Map<String, Object>> listInvitations(
            @RequestParam(required = false) String tenantId,
            @RequestParam(required = false) String status) {

        log.info("REST GET /api/v1/invitations (tenantId={}, status={})", tenantId, status);

        if (!authService.isConsultantOrAdmin()) {
            return ResponseEntity.status(403)
                    .body(Map.of("message", "Consultant or admin role required"));
        }

        List<Invitation> invitations;
        if (tenantId != null && !tenantId.isBlank()) {
            UUID tid = UUID.fromString(tenantId);
            if (!authService.canAccessTenant(tid)) {
                return ResponseEntity.status(403)
                        .body(Map.of("message", "Access denied to tenant"));
            }
            invitations = invitationRepository.findByTenantId(tid);
        } else if (authService.isSystemAdmin()) {
            invitations = invitationRepository.findAll();
        } else {
            // Consultant: only invitations for accessible tenants
            List<UUID> accessibleTenantIds = authService.getAccessibleTenantIds();
            invitations = accessibleTenantIds.isEmpty()
                    ? List.of()
                    : invitationRepository.findByTenantIdIn(accessibleTenantIds);
        }

        // Filter by status if provided
        if (status != null && !status.isBlank()) {
            invitations = invitations.stream()
                    .filter(inv -> matchesStatus(inv, status))
                    .collect(Collectors.toList());
        }

        List<Map<String, Object>> result = invitations.stream()
                .map(this::toMap)
                .toList();

        return ResponseEntity.ok(Map.of("invitations", result));
    }

    /**
     * POST /api/v1/invitations — Create a new invitation.
     */
    @PostMapping
    public ResponseEntity<Map<String, Object>> createInvitation(@RequestBody Map<String, Object> body) {
        log.info("REST POST /api/v1/invitations");

        if (!authService.isConsultantOrAdmin()) {
            return ResponseEntity.status(403)
                    .body(Map.of("message", "Consultant or admin role required"));
        }

        String email = (String) body.get("email");
        String tenantIdStr = (String) body.get("tenantId");
        String tenantRole = (String) body.getOrDefault("tenantRole", "viewer");
        String globalRole = (String) body.getOrDefault("globalRole", "viewer");

        final UUID tenantId;
        if (tenantIdStr != null && !tenantIdStr.isBlank()) {
            tenantId = UUID.fromString(tenantIdStr);
            // Verify tenant exists
            tenantRepository.findById(tenantId)
                    .orElseThrow(() -> new ResourceNotFoundException("Tenant", tenantId));
            // Verify caller is manager in this tenant (system_admin passes via hasRoleInTenant)
            if (!authService.isManagerInTenant(tenantId)) {
                return ResponseEntity.status(403)
                        .body(Map.of("message", "Manager role required in target tenant"));
            }
        } else {
            tenantId = null;
        }

        Invitation invitation = invitationService.createInvitation(email, tenantId, tenantRole, globalRole);

        return ResponseEntity.status(201).body(Map.of("invitation", toMap(invitation)));
    }

    /**
     * GET /api/v1/invitations/by-token/{token} — Get invitation details for the accept page.
     * Public endpoint — the token itself acts as auth.
     */
    @GetMapping("/by-token/{token}")
    public ResponseEntity<Map<String, Object>> getInvitationByToken(@PathVariable String token) {
        log.info("REST GET /api/v1/invitations/by-token/{}...", token.substring(0, Math.min(8, token.length())));

        Invitation invitation = invitationRepository.findByToken(token)
                .orElseThrow(() -> new ResourceNotFoundException("Invitation not found"));

        Map<String, Object> result = new HashMap<>();
        result.put("email", invitation.getEmail());
        result.put("tenantRole", invitation.getTenantRole());
        result.put("globalRole", invitation.getGlobalRole());
        result.put("expired", invitation.isExpired());
        result.put("accepted", invitation.isAccepted());
        result.put("expiresAt", invitation.getExpiresAt().toString());

        // Include tenant name if tenant is set
        if (invitation.getTenantId() != null) {
            tenantRepository.findById(invitation.getTenantId())
                    .ifPresent(tenant -> {
                        result.put("tenantId", tenant.getId().toString());
                        result.put("tenantName", tenant.getName());
                    });
        }

        return ResponseEntity.ok(Map.of("invitation", result));
    }

    /**
     * POST /api/v1/invitations/by-token/{token}/accept — Accept an invitation.
     * Authenticated users accept directly. New users supply a password
     * (and optional displayName) to create their local account in the same step.
     */
    @PostMapping("/by-token/{token}/accept")
    public ResponseEntity<Map<String, Object>> acceptInvitation(
            @PathVariable String token,
            @RequestBody(required = false) Map<String, Object> body) {
        log.info("REST POST /api/v1/invitations/by-token/{}...", token.substring(0, Math.min(8, token.length())));

        String password = body != null && body.get("password") instanceof String s ? s : null;
        String displayName = body != null && body.get("displayName") instanceof String s ? s : null;

        invitationService.acceptInvitation(token, password, displayName);

        return ResponseEntity.ok(Map.of("message", "Invitation accepted"));
    }

    /**
     * DELETE /api/v1/invitations/{id} — Revoke a pending invitation.
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String, Object>> revokeInvitation(@PathVariable String id) {
        log.info("REST DELETE /api/v1/invitations/{}", id);

        if (!authService.isConsultantOrAdmin()) {
            return ResponseEntity.status(403)
                    .body(Map.of("message", "Consultant or admin role required"));
        }

        UUID invitationId = UUID.fromString(id);
        Invitation invitation = invitationRepository.findById(invitationId)
                .orElseThrow(() -> new ResourceNotFoundException("Invitation", invitationId));

        if (invitation.isAccepted()) {
            return ResponseEntity.status(409)
                    .body(Map.of("message", "Cannot revoke an already accepted invitation"));
        }

        // Verify caller has manager access to the invitation's tenant
        if (invitation.getTenantId() != null && !authService.isManagerInTenant(invitation.getTenantId())) {
            return ResponseEntity.status(403)
                    .body(Map.of("message", "Manager role required in invitation's tenant"));
        }

        invitationRepository.delete(invitation);
        log.info("Revoked invitation {} for {}", invitationId, invitation.getEmail());

        return ResponseEntity.ok(Map.of("message", "Invitation revoked"));
    }

    private Map<String, Object> toMap(Invitation inv) {
        Map<String, Object> map = new HashMap<>();
        map.put("id", inv.getId().toString());
        map.put("email", inv.getEmail());
        map.put("tenantId", inv.getTenantId() != null ? inv.getTenantId().toString() : null);
        map.put("tenantRole", inv.getTenantRole());
        map.put("globalRole", inv.getGlobalRole());
        map.put("invitedBy", inv.getInvitedBy().toString());
        map.put("token", inv.getToken());
        map.put("status", getStatus(inv));
        map.put("expiresAt", inv.getExpiresAt().toString());
        map.put("acceptedAt", inv.getAcceptedAt() != null ? inv.getAcceptedAt().toString() : null);
        map.put("createdAt", inv.getCreatedAt() != null ? inv.getCreatedAt().toString() : null);
        return map;
    }

    private String getStatus(Invitation inv) {
        if (inv.isAccepted()) return "accepted";
        if (inv.isExpired()) return "expired";
        return "pending";
    }

    private boolean matchesStatus(Invitation inv, String status) {
        return getStatus(inv).equalsIgnoreCase(status.trim());
    }
}
