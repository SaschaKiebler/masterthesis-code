package com.digitaldemon.core.invitation;

import com.digitaldemon.core.user.AuthService;
import com.digitaldemon.core.user.GlobalRole;

import com.digitaldemon.core.tenant.Tenant;
import com.digitaldemon.core.user.User;
import com.digitaldemon.core.user.UserTenantRole;
import com.digitaldemon.core.user.TenantRole;
import com.digitaldemon.core.common.exception.ResourceNotFoundException;
import com.digitaldemon.core.common.exception.ValidationException;
import com.digitaldemon.core.tenant.TenantRepository;
import com.digitaldemon.core.user.UserRepository;
import com.digitaldemon.core.user.UserTenantRoleRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HexFormat;
import java.util.UUID;

/**
 * Service for managing user invitations (ADR-009).
 * Handles creation, validation, and acceptance of invitation tokens.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class InvitationService {

    private final InvitationRepository invitationRepository;
    private final UserRepository userRepository;
    private final TenantRepository tenantRepository;
    private final UserTenantRoleRepository userTenantRoleRepository;
    private final AuthService authService;

    private static final SecureRandom SECURE_RANDOM = new SecureRandom();
    private static final int TOKEN_BYTES = 32; // 64 hex characters

    /**
     * Create a new invitation.
     */
    @Transactional
    public Invitation createInvitation(String email, UUID tenantId, String tenantRole, String globalRole) {
        if (email == null || email.isBlank()) {
            throw new ValidationException("Email is required");
        }

        User currentUser = authService.getOrProvisionCurrentUser();

        Invitation invitation = new Invitation();
        invitation.setEmail(email.trim().toLowerCase());
        invitation.setTenantId(tenantId);
        invitation.setTenantRole(tenantRole != null ? tenantRole : "viewer");
        invitation.setGlobalRole(globalRole != null ? globalRole : "viewer");
        invitation.setInvitedBy(currentUser.getId());
        invitation.setToken(generateToken());
        invitation.setExpiresAt(Instant.now().plus(7, ChronoUnit.DAYS));
        invitation.setCreatedAt(Instant.now());

        Invitation saved = invitationRepository.save(invitation);
        log.info("Created invitation for {} to tenant {} with role {} (token: {}...)",
                email, tenantId, tenantRole, saved.getToken().substring(0, 8));

        return saved;
    }

    /**
     * Accept an invitation by token.
     * Sets the user's global role and creates tenant membership.
     */
    @Transactional
    public void acceptInvitation(String token) {
        Invitation invitation = invitationRepository.findByToken(token)
                .orElseThrow(() -> new ResourceNotFoundException("Invitation not found"));

        if (invitation.isAccepted()) {
            throw new ValidationException("Invitation has already been accepted");
        }
        if (invitation.isExpired()) {
            throw new ValidationException("Invitation has expired");
        }

        User user = authService.getOrProvisionCurrentUser();

        // Upgrade global role if the invitation specifies a higher one
        GlobalRole invitedRole = GlobalRole.fromValue(invitation.getGlobalRole());
        GlobalRole currentRole = user.getGlobalRoleEnum();
        if (shouldUpgradeRole(currentRole, invitedRole)) {
            user.setGlobalRoleEnum(invitedRole);
            userRepository.save(user);
            log.info("Upgraded user {} global role from {} to {}",
                    user.getId(), currentRole.getValue(), invitedRole.getValue());
        }

        // Create tenant membership if tenant is specified
        if (invitation.getTenantId() != null) {
            Tenant tenant = tenantRepository.findById(invitation.getTenantId())
                    .orElseThrow(() -> new ResourceNotFoundException("Tenant", invitation.getTenantId()));

            if (userTenantRoleRepository.findByUserIdAndTenantId(user.getId(), tenant.getId()).isEmpty()) {
                TenantRole tenantRole = TenantRole.fromValue(invitation.getTenantRole());
                authService.addUserToTenant(user, tenant, tenantRole);
                log.info("Added user {} to tenant {} with role {}",
                        user.getId(), tenant.getId(), tenantRole.getValue());
            }
        }

        // Mark invitation as accepted
        invitation.setAcceptedAt(Instant.now());
        invitationRepository.save(invitation);

        log.info("Invitation {} accepted by user {}", invitation.getId(), user.getId());
    }

    private String generateToken() {
        byte[] bytes = new byte[TOKEN_BYTES];
        SECURE_RANDOM.nextBytes(bytes);
        return HexFormat.of().formatHex(bytes);
    }

    private boolean shouldUpgradeRole(GlobalRole current, GlobalRole invited) {
        // Don't downgrade system_admin or consultant
        if (current == GlobalRole.SYSTEM_ADMIN) return false;
        if (current == GlobalRole.CONSULTANT && invited != GlobalRole.SYSTEM_ADMIN) return false;
        // Upgrade from viewer to anything else
        if (current == GlobalRole.VIEWER) return invited != GlobalRole.VIEWER;
        // Don't change between lateral roles (landlord, technician, resident)
        return false;
    }
}
