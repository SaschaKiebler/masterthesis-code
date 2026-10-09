package com.heatingplatform.core.invitation;

import com.heatingplatform.core.user.AuthService;
import com.heatingplatform.core.user.GlobalRole;

import com.heatingplatform.core.tenant.Tenant;
import com.heatingplatform.core.user.User;
import com.heatingplatform.core.user.UserTenantRole;
import com.heatingplatform.core.user.TenantRole;
import com.heatingplatform.core.common.exception.ResourceNotFoundException;
import com.heatingplatform.core.common.exception.ValidationException;
import com.heatingplatform.core.tenant.TenantRepository;
import com.heatingplatform.core.user.UserRepository;
import com.heatingplatform.core.user.UserTenantRoleRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.crypto.password.PasswordEncoder;
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
    private final PasswordEncoder passwordEncoder;

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
     *
     * Works for authenticated users (password ignored) as well as for new users,
     * who create their local account by supplying a password with the acceptance.
     */
    @Transactional
    public void acceptInvitation(String token, String password, String displayName) {
        Invitation invitation = invitationRepository.findByToken(token)
                .orElseThrow(() -> new ResourceNotFoundException("Invitation not found"));

        if (invitation.isAccepted()) {
            throw new ValidationException("Invitation has already been accepted");
        }
        if (invitation.isExpired()) {
            throw new ValidationException("Invitation has expired");
        }

        User user = authService.getCurrentUser()
                .orElseGet(() -> resolveInvitedUser(invitation, password, displayName));

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

    /**
     * Unauthenticated acceptance: create (or complete) the local account for the
     * invited email address using the supplied password.
     */
    private User resolveInvitedUser(Invitation invitation, String password, String displayName) {
        if (password == null || password.isBlank()) {
            throw new ValidationException("A password is required to create your account");
        }
        if (password.length() < 8) {
            throw new ValidationException("Password must be at least 8 characters");
        }

        String email = invitation.getEmail();
        User user = userRepository.findByEmail(email).orElseGet(() -> {
            User created = new User();
            created.setSubject("local|" + email);
            created.setEmail(email);
            created.setGlobalRole(GlobalRole.VIEWER.getValue());
            created.setCreatedAt(Instant.now());
            return created;
        });

        if (user.getPasswordHash() != null) {
            throw new ValidationException("An account for this email already exists. Please sign in first.");
        }

        user.setPasswordHash(passwordEncoder.encode(password));
        if (displayName != null && !displayName.isBlank()) {
            user.setDisplayName(displayName.trim());
        }
        user.setLastLoginAt(Instant.now());

        User saved = userRepository.save(user);
        log.info("Created local account for invited user {} ({})", saved.getId(), email);
        return saved;
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
