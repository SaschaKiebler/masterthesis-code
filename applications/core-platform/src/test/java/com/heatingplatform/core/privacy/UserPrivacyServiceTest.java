package com.heatingplatform.core.privacy;

import com.heatingplatform.core.audit.AccessAudit;
import com.heatingplatform.core.audit.AccessAuditRepository;
import com.heatingplatform.core.audit.AccessOutcome;
import com.heatingplatform.core.invitation.Invitation;
import com.heatingplatform.core.invitation.InvitationRepository;
import com.heatingplatform.core.site.SiteAssignmentRepository;
import com.heatingplatform.core.user.User;
import com.heatingplatform.core.user.UserRepository;
import com.heatingplatform.core.user.UserTenantRoleRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * The user-side erasure: roles and assignments cascade in the database,
 * invitations are deleted explicitly, and the audit trail stays — the
 * documented exception QS-SEC-02 has to acknowledge.
 */
@ExtendWith(MockitoExtension.class)
class UserPrivacyServiceTest {

    @Mock
    private UserRepository userRepository;
    @Mock
    private UserTenantRoleRepository userTenantRoleRepository;
    @Mock
    private SiteAssignmentRepository siteAssignmentRepository;
    @Mock
    private InvitationRepository invitationRepository;
    @Mock
    private AccessAuditRepository accessAuditRepository;

    @InjectMocks
    private UserPrivacyService service;

    private final UUID userId = UUID.randomUUID();
    private User user;

    @BeforeEach
    void setUp() {
        user = new User();
        user.setId(userId);
        user.setSubject("local|erika");
        user.setEmail("erika@example.org");
        user.setDisplayName("Erika Musterfrau");

        given(userRepository.findById(userId)).willReturn(Optional.of(user));
        given(userTenantRoleRepository.findByUserId(userId)).willReturn(List.of());
        given(siteAssignmentRepository.findByUserId(userId)).willReturn(List.of());
    }

    private Invitation invitation() {
        Invitation invitation = new Invitation();
        invitation.setId(UUID.randomUUID());
        invitation.setEmail("erika@example.org");
        invitation.setTenantId(UUID.randomUUID());
        invitation.setTenantRole("viewer");
        return invitation;
    }

    private AccessAudit auditEntry() {
        AccessAudit entry = new AccessAudit();
        entry.setSubject("local|erika");
        entry.setOccurredAt(Instant.parse("2026-08-10T12:00:00Z"));
        entry.setMethod("GET");
        entry.setPath("/api/v1/projects");
        entry.setHttpStatus(403);
        entry.setOutcome(AccessOutcome.DENIED);
        return entry;
    }

    @Test
    void export_includes_the_audit_trail_and_names_the_retention() {
        given(invitationRepository.findByEmail("erika@example.org"))
                .willReturn(List.of(invitation()));
        given(accessAuditRepository.findBySubject("local|erika"))
                .willReturn(List.of(auditEntry()));

        UserPrivacyService.UserExport export = service.export(userId);

        assertThat(export.email()).isEqualTo("erika@example.org");
        assertThat(export.invitations()).hasSize(1);
        assertThat(export.accessAudit()).singleElement()
                .satisfies(a -> assertThat(a.outcome()).isEqualTo("DENIED"));
        assertThat(export.auditRetentionNote()).contains("UC-BET-05");
    }

    @Test
    void erasure_deletes_user_and_invitations_but_keeps_the_audit_trail() {
        List<Invitation> invitations = List.of(invitation());
        given(invitationRepository.findByEmail("erika@example.org")).willReturn(invitations);
        given(accessAuditRepository.findBySubject("local|erika"))
                .willReturn(List.of(auditEntry()));

        UserPrivacyService.ErasureReport report = service.erase(userId);

        verify(invitationRepository).deleteAll(invitations);
        verify(userRepository).delete(user);
        verify(accessAuditRepository, never()).deleteAll();
        assertThat(report.deletedInvitations()).isEqualTo(1);
        assertThat(report.retainedAuditEntries()).isEqualTo(1);
    }

    /** A user without an e-mail must not match every e-mail-less invitation. */
    @Test
    void erasure_without_email_touches_no_invitations() {
        user.setEmail(null);
        given(accessAuditRepository.findBySubject("local|erika")).willReturn(List.of());

        UserPrivacyService.ErasureReport report = service.erase(userId);

        verify(invitationRepository).deleteAll(List.of());
        assertThat(report.deletedInvitations()).isZero();
    }
}
