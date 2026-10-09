package com.heatingplatform.core.user;

import com.heatingplatform.core.tenant.Tenant;
import com.heatingplatform.core.site.SiteAssignment;
import com.heatingplatform.core.ontology.ObjectEntity;
import com.heatingplatform.core.ontology.OntologyService;
import com.heatingplatform.core.ontology.ObjectRepository;
import com.heatingplatform.core.site.SiteAssignmentRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Central authorization service for the RBAC multi-tenancy model (ADR-009).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AuthService {

    private final UserRepository userRepository;
    private final UserTenantRoleRepository userTenantRoleRepository;
    private final SiteAssignmentRepository siteAssignmentRepository;
    private final ObjectRepository objectRepository;

    // ── JWT Extraction ──────────────────────────────────────────────────

    public Optional<String> getCurrentSubject() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !(authentication.getPrincipal() instanceof Jwt jwt)) {
            return Optional.empty();
        }
        return Optional.ofNullable(jwt.getSubject());
    }

    public Optional<String> getCurrentEmail() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication != null && authentication.getPrincipal() instanceof Jwt jwt) {
            String email = jwt.getClaimAsString("email");
            if (email != null) return Optional.of(email);
        }
        return getCurrentUser().map(User::getEmail);
    }

    // ── User Resolution ─────────────────────────────────────────────────

    public Optional<User> getCurrentUser() {
        return getCurrentSubject()
            .flatMap(userRepository::findBySubject);
    }

    @Transactional
    public User getOrProvisionCurrentUser() {
        String subject = getCurrentSubject()
            .orElseThrow(() -> new SecurityException("No authenticated user"));

        Optional<User> bySubject = userRepository.findBySubject(subject);
        if (bySubject.isPresent()) {
            User user = bySubject.get();
            getCurrentEmail().ifPresent(user::setEmail);
            getJwtClaim("name").ifPresent(user::setDisplayName);
            getJwtClaim("picture").ifPresent(user::setAvatarUrl);
            user.setLastLoginAt(Instant.now());
            return userRepository.save(user);
        }

        Optional<String> email = getCurrentEmail();
        if (email.isPresent()) {
            Optional<User> byEmail = userRepository.findByEmail(email.get());
            if (byEmail.isPresent()) {
                User user = byEmail.get();
                log.info("Linking existing user {} to new subject (was: {}, now: {})",
                        user.getEmail(), user.getSubject(), subject);
                user.setSubject(subject);
                getJwtClaim("name").ifPresent(user::setDisplayName);
                getJwtClaim("picture").ifPresent(user::setAvatarUrl);
                user.setLastLoginAt(Instant.now());
                return userRepository.save(user);
            }
        }

        log.info("Auto-provisioning new user for subject: {}", subject);
        User user = new User();
        user.setSubject(subject);
        user.setEmail(email.orElse(null));
        user.setDisplayName(getJwtClaim("name").orElse(null));
        user.setAvatarUrl(getJwtClaim("picture").orElse(null));
        user.setGlobalRole(GlobalRole.VIEWER.getValue());
        user.setCreatedAt(Instant.now());
        user.setLastLoginAt(Instant.now());
        return userRepository.save(user);
    }

    // ── Global Role Checks ──────────────────────────────────────────────

    public GlobalRole getCurrentGlobalRole() {
        return getCurrentUser()
            .map(User::getGlobalRoleEnum)
            .orElse(GlobalRole.VIEWER);
    }

    public boolean isSystemAdmin() {
        return getCurrentGlobalRole() == GlobalRole.SYSTEM_ADMIN;
    }

    public boolean isConsultant() {
        GlobalRole role = getCurrentGlobalRole();
        return role == GlobalRole.CONSULTANT || role == GlobalRole.SYSTEM_ADMIN;
    }

    public boolean isConsultantOrAdmin() {
        return isConsultant();
    }

    // ── Tenant Role Checks ──────────────────────────────────────────────

    public List<UUID> getAccessibleTenantIds() {
        Optional<User> user = getCurrentUser();
        if (user.isEmpty()) return List.of();

        if (user.get().getGlobalRoleEnum() == GlobalRole.SYSTEM_ADMIN) {
            return List.of();
        }

        return userTenantRoleRepository.findTenantIdsByUserId(user.get().getId());
    }

    public boolean hasRoleInTenant(UUID tenantId, TenantRole minimumRole) {
        Optional<User> user = getCurrentUser();
        if (user.isEmpty()) return false;

        if (user.get().getGlobalRoleEnum() == GlobalRole.SYSTEM_ADMIN) return true;

        return userTenantRoleRepository.findByUserIdAndTenantId(user.get().getId(), tenantId)
            .map(utr -> utr.getTenantRoleEnum().isAtLeast(minimumRole))
            .orElse(false);
    }

    public boolean canAccessTenant(UUID tenantId) {
        return hasRoleInTenant(tenantId, TenantRole.VIEWER);
    }

    public boolean isManagerInTenant(UUID tenantId) {
        return hasRoleInTenant(tenantId, TenantRole.MANAGER);
    }

    // ── Site Access Checks ──────────────────────────────────────────────

    public boolean canAccessSite(UUID siteId) {
        Optional<User> user = getCurrentUser();
        if (user.isEmpty()) return false;

        if (user.get().getGlobalRoleEnum() == GlobalRole.SYSTEM_ADMIN) return true;

        ObjectEntity obj = objectRepository.findById(siteId).orElse(null);
        if (obj == null) return false;

        UUID tenantId = obj.getTenant() != null ? obj.getTenant().getId() : null;
        if (tenantId != null && canAccessTenant(tenantId)) return true;

        return siteAssignmentRepository.existsByUserIdAndSiteId(user.get().getId(), siteId);
    }

    public List<UUID> getAccessibleSiteIds() {
        Optional<User> user = getCurrentUser();
        if (user.isEmpty()) return List.of();

        if (user.get().getGlobalRoleEnum() == GlobalRole.SYSTEM_ADMIN) return null;

        if (user.get().getGlobalRoleEnum() == GlobalRole.TECHNICIAN) {
            List<UUID> assignedSites = siteAssignmentRepository.findSiteIdsByUserId(user.get().getId());
            List<UUID> tenantIds = getAccessibleTenantIds();
            List<UUID> tenantSites = objectRepository.findIdsByTenantIdsAndObjectTypeName(tenantIds, OntologyService.BUILDING);

            java.util.Set<UUID> combined = new java.util.HashSet<>(assignedSites);
            combined.addAll(tenantSites);
            return List.copyOf(combined);
        }

        List<UUID> tenantIds = getAccessibleTenantIds();
        return objectRepository.findIdsByTenantIdsAndObjectTypeName(tenantIds, OntologyService.BUILDING);
    }

    // ── Tenant Membership Management ────────────────────────────────────

    public UserTenantRole addUserToTenant(User user, Tenant tenant, TenantRole role) {
        UserTenantRole utr = new UserTenantRole();
        utr.setUser(user);
        utr.setTenant(tenant);
        utr.setTenantRoleEnum(role);
        utr.setCreatedAt(Instant.now());
        return userTenantRoleRepository.save(utr);
    }

    public List<UserTenantRole> getCurrentUserTenantRoles() {
        return getCurrentUser()
            .map(user -> userTenantRoleRepository.findByUserId(user.getId()))
            .orElse(List.of());
    }

    public User saveUser(User user) {
        return userRepository.save(user);
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    private Optional<String> getJwtClaim(String claim) {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication != null && authentication.getPrincipal() instanceof Jwt jwt) {
            return Optional.ofNullable(jwt.getClaimAsString(claim));
        }
        return Optional.empty();
    }
}
