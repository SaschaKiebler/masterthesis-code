package com.digitaldemon.core.gateway;

import com.digitaldemon.core.invitation.InvitationController;

import com.digitaldemon.core.invitation.Invitation;
import com.digitaldemon.core.tenant.Tenant;
import com.digitaldemon.core.invitation.InvitationRepository;
import com.digitaldemon.core.tenant.TenantRepository;
import com.digitaldemon.core.user.AuthService;
import com.digitaldemon.core.invitation.InvitationService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class InvitationControllerTest {

    @Mock
    private InvitationRepository invitationRepository;

    @Mock
    private TenantRepository tenantRepository;

    @Mock
    private InvitationService invitationService;

    @Mock
    private AuthService authService;

    @InjectMocks
    private InvitationController invitationController;

    private Tenant tenant;
    private Invitation pendingInvitation;
    private Invitation acceptedInvitation;
    private Invitation expiredInvitation;

    @BeforeEach
    void setUp() {
        tenant = new Tenant();
        tenant.setId(UUID.randomUUID());
        tenant.setName("Test Tenant");

        pendingInvitation = new Invitation();
        pendingInvitation.setId(UUID.randomUUID());
        pendingInvitation.setEmail("pending@example.com");
        pendingInvitation.setTenantId(tenant.getId());
        pendingInvitation.setTenantRole("owner");
        pendingInvitation.setGlobalRole("landlord");
        pendingInvitation.setInvitedBy(UUID.randomUUID());
        pendingInvitation.setToken("pending-token-abc123");
        pendingInvitation.setExpiresAt(Instant.now().plus(7, ChronoUnit.DAYS));
        pendingInvitation.setAcceptedAt(null);
        pendingInvitation.setCreatedAt(Instant.now());

        acceptedInvitation = new Invitation();
        acceptedInvitation.setId(UUID.randomUUID());
        acceptedInvitation.setEmail("accepted@example.com");
        acceptedInvitation.setTenantId(tenant.getId());
        acceptedInvitation.setTenantRole("viewer");
        acceptedInvitation.setGlobalRole("viewer");
        acceptedInvitation.setInvitedBy(UUID.randomUUID());
        acceptedInvitation.setToken("accepted-token-def456");
        acceptedInvitation.setExpiresAt(Instant.now().plus(7, ChronoUnit.DAYS));
        acceptedInvitation.setAcceptedAt(Instant.now());
        acceptedInvitation.setCreatedAt(Instant.now().minus(1, ChronoUnit.DAYS));

        expiredInvitation = new Invitation();
        expiredInvitation.setId(UUID.randomUUID());
        expiredInvitation.setEmail("expired@example.com");
        expiredInvitation.setTenantId(tenant.getId());
        expiredInvitation.setTenantRole("viewer");
        expiredInvitation.setGlobalRole("viewer");
        expiredInvitation.setInvitedBy(UUID.randomUUID());
        expiredInvitation.setToken("expired-token-ghi789");
        expiredInvitation.setExpiresAt(Instant.now().minus(1, ChronoUnit.HOURS));
        expiredInvitation.setAcceptedAt(null);
        expiredInvitation.setCreatedAt(Instant.now().minus(8, ChronoUnit.DAYS));
    }

    @Nested
    class ListInvitations {

        @Test
        void shouldReturnAllInvitationsForAdmin() {
            given(authService.isConsultantOrAdmin()).willReturn(true);
            given(invitationRepository.findAll())
                    .willReturn(List.of(pendingInvitation, acceptedInvitation, expiredInvitation));

            ResponseEntity<Map<String, Object>> response =
                    invitationController.listInvitations(null, null);

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
            @SuppressWarnings("unchecked")
            List<?> invitations = (List<?>) response.getBody().get("invitations");
            assertThat(invitations).hasSize(3);
        }

        @Test
        void shouldFilterByTenantId() {
            given(authService.isConsultantOrAdmin()).willReturn(true);
            given(invitationRepository.findByTenantId(tenant.getId()))
                    .willReturn(List.of(pendingInvitation));

            ResponseEntity<Map<String, Object>> response =
                    invitationController.listInvitations(tenant.getId().toString(), null);

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
            verify(invitationRepository).findByTenantId(tenant.getId());
            verify(invitationRepository, never()).findAll();
        }

        @Test
        void shouldFilterByStatus() {
            given(authService.isConsultantOrAdmin()).willReturn(true);
            given(invitationRepository.findAll())
                    .willReturn(List.of(pendingInvitation, acceptedInvitation, expiredInvitation));

            ResponseEntity<Map<String, Object>> response =
                    invitationController.listInvitations(null, "pending");

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> invitations =
                    (List<Map<String, Object>>) response.getBody().get("invitations");
            assertThat(invitations).hasSize(1);
            assertThat(invitations.get(0).get("status")).isEqualTo("pending");
        }

        @Test
        void shouldReturn403ForNonAdmin() {
            given(authService.isConsultantOrAdmin()).willReturn(false);

            ResponseEntity<Map<String, Object>> response =
                    invitationController.listInvitations(null, null);

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        }
    }

    @Nested
    class CreateInvitation {

        @Test
        void shouldCreateInvitationWithTenant() {
            given(authService.isConsultantOrAdmin()).willReturn(true);
            given(tenantRepository.findById(tenant.getId())).willReturn(Optional.of(tenant));
            given(invitationService.createInvitation("new@example.com", tenant.getId(), "owner", "landlord"))
                    .willReturn(pendingInvitation);

            ResponseEntity<Map<String, Object>> response = invitationController.createInvitation(
                    Map.of("email", "new@example.com",
                            "tenantId", tenant.getId().toString(),
                            "tenantRole", "owner",
                            "globalRole", "landlord"));

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);
            @SuppressWarnings("unchecked")
            Map<String, Object> invitation = (Map<String, Object>) response.getBody().get("invitation");
            assertThat(invitation.get("email")).isEqualTo("pending@example.com");
            assertThat(invitation.get("token")).isNotNull();
        }

        @Test
        void shouldCreateInvitationWithoutTenant() {
            given(authService.isConsultantOrAdmin()).willReturn(true);
            given(invitationService.createInvitation("consultant@example.com", null, "viewer", "consultant"))
                    .willReturn(pendingInvitation);

            ResponseEntity<Map<String, Object>> response = invitationController.createInvitation(
                    Map.of("email", "consultant@example.com",
                            "globalRole", "consultant"));

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        }

        @Test
        void shouldReturn403ForNonAdmin() {
            given(authService.isConsultantOrAdmin()).willReturn(false);

            ResponseEntity<Map<String, Object>> response = invitationController.createInvitation(
                    Map.of("email", "new@example.com"));

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
            verify(invitationService, never()).createInvitation(any(), any(), any(), any());
        }
    }

    @Nested
    class GetInvitationByToken {

        @Test
        void shouldReturnInvitationDetails() {
            given(invitationRepository.findByToken("pending-token-abc123"))
                    .willReturn(Optional.of(pendingInvitation));
            given(tenantRepository.findById(tenant.getId())).willReturn(Optional.of(tenant));

            ResponseEntity<Map<String, Object>> response =
                    invitationController.getInvitationByToken("pending-token-abc123");

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
            @SuppressWarnings("unchecked")
            Map<String, Object> invitation = (Map<String, Object>) response.getBody().get("invitation");
            assertThat(invitation.get("email")).isEqualTo("pending@example.com");
            assertThat(invitation.get("tenantName")).isEqualTo("Test Tenant");
            assertThat(invitation.get("expired")).isEqualTo(false);
            assertThat(invitation.get("accepted")).isEqualTo(false);
        }

        @Test
        void shouldIndicateExpiredInvitation() {
            given(invitationRepository.findByToken("expired-token-ghi789"))
                    .willReturn(Optional.of(expiredInvitation));

            ResponseEntity<Map<String, Object>> response =
                    invitationController.getInvitationByToken("expired-token-ghi789");

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
            @SuppressWarnings("unchecked")
            Map<String, Object> invitation = (Map<String, Object>) response.getBody().get("invitation");
            assertThat(invitation.get("expired")).isEqualTo(true);
        }
    }

    @Nested
    class AcceptInvitation {

        @Test
        void shouldDelegateToService() {
            invitationController.acceptInvitation("some-token");

            verify(invitationService).acceptInvitation("some-token");
        }
    }

    @Nested
    class RevokeInvitation {

        @Test
        void shouldRevokePendingInvitation() {
            given(authService.isConsultantOrAdmin()).willReturn(true);
            given(invitationRepository.findById(pendingInvitation.getId()))
                    .willReturn(Optional.of(pendingInvitation));

            ResponseEntity<Map<String, Object>> response =
                    invitationController.revokeInvitation(pendingInvitation.getId().toString());

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
            verify(invitationRepository).delete(pendingInvitation);
        }

        @Test
        void shouldReturn409WhenAlreadyAccepted() {
            given(authService.isConsultantOrAdmin()).willReturn(true);
            given(invitationRepository.findById(acceptedInvitation.getId()))
                    .willReturn(Optional.of(acceptedInvitation));

            ResponseEntity<Map<String, Object>> response =
                    invitationController.revokeInvitation(acceptedInvitation.getId().toString());

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
            verify(invitationRepository, never()).delete(any());
        }

        @Test
        void shouldReturn403ForNonAdmin() {
            given(authService.isConsultantOrAdmin()).willReturn(false);

            ResponseEntity<Map<String, Object>> response =
                    invitationController.revokeInvitation(pendingInvitation.getId().toString());

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        }
    }
}
