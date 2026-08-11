package com.digitaldemon.core.privacy;

import com.digitaldemon.core.audit.AccessAudit;
import com.digitaldemon.core.audit.AccessAuditRepository;
import com.digitaldemon.core.common.exception.ResourceNotFoundException;
import com.digitaldemon.core.invitation.Invitation;
import com.digitaldemon.core.invitation.InvitationRepository;
import com.digitaldemon.core.site.SiteAssignment;
import com.digitaldemon.core.site.SiteAssignmentRepository;
import com.digitaldemon.core.user.User;
import com.digitaldemon.core.user.UserRepository;
import com.digitaldemon.core.user.UserTenantRole;
import com.digitaldemon.core.user.UserTenantRoleRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * GDPR subject-access and erasure for platform users, the second data-subject
 * category next to residents (thesis QS-SEC-02).
 *
 * <p>Deliberate exception, stated in every report: {@code access_audit} rows
 * are retained. A security trail that a deletion request could empty would
 * defeat its purpose (UC-BET-05); after user deletion the rows only carry a
 * subject string that no longer resolves to a person. UUID traces in
 * {@code invited_by}, {@code assigned_by} and {@code created_by} likewise stay
 * behind as unresolvable identifiers and are listed as documented residuals in
 * the evaluation, not silently ignored.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class UserPrivacyService {

    private static final String AUDIT_RETENTION_NOTE =
            "access_audit entries are retained for security accountability (UC-BET-05); "
                    + "after erasure their subject no longer resolves to a person.";

    private final UserRepository userRepository;
    private final UserTenantRoleRepository userTenantRoleRepository;
    private final SiteAssignmentRepository siteAssignmentRepository;
    private final InvitationRepository invitationRepository;
    private final AccessAuditRepository accessAuditRepository;

    // ── Report shapes ─────────────────────────────────────────────────────────

    public record TenantRoleEntry(UUID tenantId, String role) {
    }

    public record SiteAssignmentEntry(UUID siteId, String siteName, String notes) {
    }

    public record InvitationEntry(UUID id, UUID tenantId, String role, Instant createdAt,
                                  Instant acceptedAt) {
    }

    public record AuditEntry(Instant occurredAt, String method, String path, int httpStatus,
                             String outcome) {
    }

    public record UserExport(UUID id, String subject, String email, String displayName,
                             String globalRole, Instant lastLoginAt,
                             List<TenantRoleEntry> tenantRoles,
                             List<SiteAssignmentEntry> siteAssignments,
                             List<InvitationEntry> invitations,
                             List<AuditEntry> accessAudit,
                             String auditRetentionNote) {
    }

    public record ErasureReport(UUID userId, int deletedTenantRoles, int deletedSiteAssignments,
                                int deletedInvitations, long retainedAuditEntries,
                                String auditRetentionNote) {
    }

    // ── Export ────────────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public UserExport export(UUID userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User", userId));

        List<AccessAudit> audit = accessAuditRepository.findBySubject(user.getSubject());

        return new UserExport(
                user.getId(), user.getSubject(), user.getEmail(), user.getDisplayName(),
                user.getGlobalRole(), user.getLastLoginAt(),
                userTenantRoleRepository.findByUserId(userId).stream()
                        .map(r -> new TenantRoleEntry(r.getTenant().getId(), r.getTenantRole()))
                        .toList(),
                siteAssignmentRepository.findByUserId(userId).stream()
                        .map(a -> new SiteAssignmentEntry(
                                a.getSite().getId(), a.getSite().getDisplayName(), a.getNotes()))
                        .toList(),
                invitationsFor(user).stream()
                        .map(i -> new InvitationEntry(i.getId(), i.getTenantId(),
                                i.getTenantRole(), i.getCreatedAt(), i.getAcceptedAt()))
                        .toList(),
                audit.stream()
                        .map(a -> new AuditEntry(a.getOccurredAt(), a.getMethod(), a.getPath(),
                                a.getHttpStatus(), a.getOutcome().name()))
                        .toList(),
                AUDIT_RETENTION_NOTE);
    }

    // ── Erasure ───────────────────────────────────────────────────────────────

    @Transactional
    public ErasureReport erase(UUID userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User", userId));

        List<UserTenantRole> roles = userTenantRoleRepository.findByUserId(userId);
        List<SiteAssignment> assignments = siteAssignmentRepository.findByUserId(userId);
        List<Invitation> invitations = invitationsFor(user);
        long auditEntries = accessAuditRepository.findBySubject(user.getSubject()).size();

        // Invitations carry the e-mail in clear text and have no FK, so they
        // are removed explicitly; roles and assignments cascade in the
        // database (ON DELETE CASCADE on their user FK).
        invitationRepository.deleteAll(invitations);
        userRepository.delete(user);

        log.info("Erased user {} ({} roles, {} assignments cascaded, {} invitations deleted, "
                        + "{} audit entries retained)",
                userId, roles.size(), assignments.size(), invitations.size(), auditEntries);

        return new ErasureReport(userId, roles.size(), assignments.size(), invitations.size(),
                auditEntries, AUDIT_RETENTION_NOTE);
    }

    private List<Invitation> invitationsFor(User user) {
        if (user.getEmail() == null || user.getEmail().isBlank()) {
            return List.of();
        }
        return invitationRepository.findByEmail(user.getEmail());
    }
}
