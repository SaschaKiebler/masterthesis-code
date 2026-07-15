package com.digitaldemon.core.service;

import com.digitaldemon.core.user.AuthService;
import com.digitaldemon.core.user.UserTenantRole;
import com.digitaldemon.core.user.TenantRole;

import com.digitaldemon.core.user.User;
import com.digitaldemon.core.tenant.Tenant;
import com.digitaldemon.core.invitation.Invitation;
import com.digitaldemon.core.invitation.InvitationService;
import com.digitaldemon.core.common.exception.ResourceNotFoundException;
import com.digitaldemon.core.common.exception.ValidationException;
import com.digitaldemon.core.invitation.InvitationRepository;
import com.digitaldemon.core.tenant.TenantRepository;
import com.digitaldemon.core.user.UserRepository;
import com.digitaldemon.core.user.UserTenantRoleRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class InvitationServiceTest {

    @Mock
    private InvitationRepository invitationRepository;

    @Mock
    private UserRepository userRepository;

    @Mock
    private TenantRepository tenantRepository;

    @Mock
    private UserTenantRoleRepository userTenantRoleRepository;

    @Mock
    private AuthService authService;

    @InjectMocks
    private InvitationService invitationService;

    private User currentUser;
    private Tenant tenant;

    @BeforeEach
    void setUp() {
        currentUser = new User();
        currentUser.setId(UUID.randomUUID());
        currentUser.setEmail("admin@example.com");
        currentUser.setGlobalRole("system_admin");

        tenant = new Tenant();
        tenant.setId(UUID.randomUUID());
        tenant.setName("Test Tenant");
    }

    @Nested
    class CreateInvitation {

        @Test
        void shouldCreateInvitationWithValidData() {
            given(authService.getOrProvisionCurrentUser()).willReturn(currentUser);
            given(invitationRepository.save(any(Invitation.class))).willAnswer(inv -> {
                Invitation i = inv.getArgument(0);
                i.setId(UUID.randomUUID());
                return i;
            });

            Invitation result = invitationService.createInvitation(
                    "user@example.com", tenant.getId(), "owner", "landlord");

            assertThat(result).isNotNull();
            assertThat(result.getEmail()).isEqualTo("user@example.com");
            assertThat(result.getTenantId()).isEqualTo(tenant.getId());
            assertThat(result.getTenantRole()).isEqualTo("owner");
            assertThat(result.getGlobalRole()).isEqualTo("landlord");
            assertThat(result.getInvitedBy()).isEqualTo(currentUser.getId());
            assertThat(result.getToken()).hasSize(64); // 32 bytes = 64 hex chars
            assertThat(result.getExpiresAt()).isAfter(Instant.now().plus(6, ChronoUnit.DAYS));
            assertThat(result.getCreatedAt()).isNotNull();

            verify(invitationRepository).save(any(Invitation.class));
        }

        @Test
        void shouldNormalizeEmailToLowerCase() {
            given(authService.getOrProvisionCurrentUser()).willReturn(currentUser);
            given(invitationRepository.save(any(Invitation.class))).willAnswer(inv -> inv.getArgument(0));

            ArgumentCaptor<Invitation> captor = ArgumentCaptor.forClass(Invitation.class);

            invitationService.createInvitation("USER@EXAMPLE.COM", null, "viewer", "viewer");

            verify(invitationRepository).save(captor.capture());
            assertThat(captor.getValue().getEmail()).isEqualTo("user@example.com");
        }

        @Test
        void shouldDefaultToViewerRolesWhenNull() {
            given(authService.getOrProvisionCurrentUser()).willReturn(currentUser);
            given(invitationRepository.save(any(Invitation.class))).willAnswer(inv -> inv.getArgument(0));

            ArgumentCaptor<Invitation> captor = ArgumentCaptor.forClass(Invitation.class);

            invitationService.createInvitation("user@example.com", null, null, null);

            verify(invitationRepository).save(captor.capture());
            assertThat(captor.getValue().getTenantRole()).isEqualTo("viewer");
            assertThat(captor.getValue().getGlobalRole()).isEqualTo("viewer");
        }

        @Test
        void shouldThrowWhenEmailIsNull() {
            assertThatThrownBy(() ->
                    invitationService.createInvitation(null, null, "viewer", "viewer"))
                    .isInstanceOf(ValidationException.class)
                    .hasMessageContaining("Email is required");

            verify(invitationRepository, never()).save(any());
        }

        @Test
        void shouldThrowWhenEmailIsBlank() {
            assertThatThrownBy(() ->
                    invitationService.createInvitation("   ", null, "viewer", "viewer"))
                    .isInstanceOf(ValidationException.class)
                    .hasMessageContaining("Email is required");

            verify(invitationRepository, never()).save(any());
        }

        @Test
        void shouldGenerateUniqueTokens() {
            given(authService.getOrProvisionCurrentUser()).willReturn(currentUser);
            given(invitationRepository.save(any(Invitation.class))).willAnswer(inv -> inv.getArgument(0));

            Invitation inv1 = invitationService.createInvitation("a@example.com", null, "viewer", "viewer");
            Invitation inv2 = invitationService.createInvitation("b@example.com", null, "viewer", "viewer");

            assertThat(inv1.getToken()).isNotEqualTo(inv2.getToken());
        }
    }

    @Nested
    class AcceptInvitation {

        private Invitation pendingInvitation;
        private User invitedUser;

        @BeforeEach
        void setUp() {
            pendingInvitation = new Invitation();
            pendingInvitation.setId(UUID.randomUUID());
            pendingInvitation.setEmail("invitee@example.com");
            pendingInvitation.setTenantId(tenant.getId());
            pendingInvitation.setTenantRole("owner");
            pendingInvitation.setGlobalRole("landlord");
            pendingInvitation.setToken("valid-token-123");
            pendingInvitation.setExpiresAt(Instant.now().plus(7, ChronoUnit.DAYS));
            pendingInvitation.setAcceptedAt(null);

            invitedUser = new User();
            invitedUser.setId(UUID.randomUUID());
            invitedUser.setEmail("invitee@example.com");
            invitedUser.setGlobalRole("viewer");
        }

        @Test
        void shouldAcceptValidInvitation() {
            given(invitationRepository.findByToken("valid-token-123")).willReturn(Optional.of(pendingInvitation));
            given(authService.getCurrentUser()).willReturn(Optional.of(invitedUser));
            given(tenantRepository.findById(tenant.getId())).willReturn(Optional.of(tenant));
            given(userTenantRoleRepository.findByUserIdAndTenantId(invitedUser.getId(), tenant.getId()))
                    .willReturn(Optional.empty());

            invitationService.acceptInvitation("valid-token-123", null, null);

            // User's global role should be upgraded to landlord
            verify(userRepository).save(invitedUser);
            assertThat(invitedUser.getGlobalRole()).isEqualTo("landlord");

            // Tenant membership should be created
            verify(authService).addUserToTenant(invitedUser, tenant, TenantRole.OWNER);

            // Invitation should be marked as accepted
            verify(invitationRepository).save(pendingInvitation);
            assertThat(pendingInvitation.getAcceptedAt()).isNotNull();
        }

        @Test
        void shouldNotDowngradeSystemAdmin() {
            invitedUser.setGlobalRole("system_admin");

            given(invitationRepository.findByToken("valid-token-123")).willReturn(Optional.of(pendingInvitation));
            given(authService.getCurrentUser()).willReturn(Optional.of(invitedUser));
            given(tenantRepository.findById(tenant.getId())).willReturn(Optional.of(tenant));
            given(userTenantRoleRepository.findByUserIdAndTenantId(invitedUser.getId(), tenant.getId()))
                    .willReturn(Optional.empty());

            invitationService.acceptInvitation("valid-token-123", null, null);

            // Global role should NOT change
            assertThat(invitedUser.getGlobalRole()).isEqualTo("system_admin");
            verify(userRepository, never()).save(invitedUser);
        }

        @Test
        void shouldNotDowngradeConsultantToLandlord() {
            invitedUser.setGlobalRole("consultant");

            given(invitationRepository.findByToken("valid-token-123")).willReturn(Optional.of(pendingInvitation));
            given(authService.getCurrentUser()).willReturn(Optional.of(invitedUser));
            given(tenantRepository.findById(tenant.getId())).willReturn(Optional.of(tenant));
            given(userTenantRoleRepository.findByUserIdAndTenantId(invitedUser.getId(), tenant.getId()))
                    .willReturn(Optional.empty());

            invitationService.acceptInvitation("valid-token-123", null, null);

            assertThat(invitedUser.getGlobalRole()).isEqualTo("consultant");
            verify(userRepository, never()).save(invitedUser);
        }

        @Test
        void shouldUpgradeViewerToLandlord() {
            invitedUser.setGlobalRole("viewer");

            given(invitationRepository.findByToken("valid-token-123")).willReturn(Optional.of(pendingInvitation));
            given(authService.getCurrentUser()).willReturn(Optional.of(invitedUser));
            given(tenantRepository.findById(tenant.getId())).willReturn(Optional.of(tenant));
            given(userTenantRoleRepository.findByUserIdAndTenantId(invitedUser.getId(), tenant.getId()))
                    .willReturn(Optional.empty());

            invitationService.acceptInvitation("valid-token-123", null, null);

            verify(userRepository).save(invitedUser);
            assertThat(invitedUser.getGlobalRole()).isEqualTo("landlord");
        }

        @Test
        void shouldNotCreateDuplicateTenantMembership() {
            UserTenantRole existingRole = new UserTenantRole();
            existingRole.setId(UUID.randomUUID());

            given(invitationRepository.findByToken("valid-token-123")).willReturn(Optional.of(pendingInvitation));
            given(authService.getCurrentUser()).willReturn(Optional.of(invitedUser));
            given(tenantRepository.findById(tenant.getId())).willReturn(Optional.of(tenant));
            given(userTenantRoleRepository.findByUserIdAndTenantId(invitedUser.getId(), tenant.getId()))
                    .willReturn(Optional.of(existingRole));

            invitationService.acceptInvitation("valid-token-123", null, null);

            // Should NOT try to add user to tenant again
            verify(authService, never()).addUserToTenant(any(), any(), any());
        }

        @Test
        void shouldThrowWhenTokenNotFound() {
            given(invitationRepository.findByToken("nonexistent")).willReturn(Optional.empty());

            assertThatThrownBy(() -> invitationService.acceptInvitation("nonexistent", null, null))
                    .isInstanceOf(ResourceNotFoundException.class);
        }

        @Test
        void shouldThrowWhenAlreadyAccepted() {
            pendingInvitation.setAcceptedAt(Instant.now());
            given(invitationRepository.findByToken("valid-token-123")).willReturn(Optional.of(pendingInvitation));

            assertThatThrownBy(() -> invitationService.acceptInvitation("valid-token-123", null, null))
                    .isInstanceOf(ValidationException.class)
                    .hasMessageContaining("already been accepted");
        }

        @Test
        void shouldThrowWhenExpired() {
            pendingInvitation.setExpiresAt(Instant.now().minus(1, ChronoUnit.HOURS));
            given(invitationRepository.findByToken("valid-token-123")).willReturn(Optional.of(pendingInvitation));

            assertThatThrownBy(() -> invitationService.acceptInvitation("valid-token-123", null, null))
                    .isInstanceOf(ValidationException.class)
                    .hasMessageContaining("expired");
        }

        @Test
        void shouldHandleInvitationWithoutTenant() {
            pendingInvitation.setTenantId(null);
            pendingInvitation.setGlobalRole("consultant");

            given(invitationRepository.findByToken("valid-token-123")).willReturn(Optional.of(pendingInvitation));
            given(authService.getCurrentUser()).willReturn(Optional.of(invitedUser));

            invitationService.acceptInvitation("valid-token-123", null, null);

            // Should upgrade role
            verify(userRepository).save(invitedUser);
            assertThat(invitedUser.getGlobalRole()).isEqualTo("consultant");

            // Should NOT try to create tenant membership
            verify(tenantRepository, never()).findById(any());
            verify(authService, never()).addUserToTenant(any(), any(), any());
        }
    }
}
