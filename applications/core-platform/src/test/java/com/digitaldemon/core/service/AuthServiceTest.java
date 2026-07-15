package com.digitaldemon.core.service;

import com.digitaldemon.core.user.User;
import com.digitaldemon.core.user.UserTenantRole;
import com.digitaldemon.core.user.TenantRole;
import com.digitaldemon.core.user.AuthService;
import com.digitaldemon.core.ontology.ObjectEntity;
import com.digitaldemon.core.ontology.OntologyService;
import com.digitaldemon.core.user.GlobalRole;
import com.digitaldemon.core.user.TenantRole;
import com.digitaldemon.core.tenant.Tenant;
import com.digitaldemon.core.site.SiteAssignment;
import com.digitaldemon.core.ontology.ObjectRepository;
import com.digitaldemon.core.site.SiteAssignmentRepository;
import com.digitaldemon.core.user.UserRepository;
import com.digitaldemon.core.user.UserTenantRoleRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class AuthServiceTest {

    @Mock
    private UserRepository userRepository;

    @Mock
    private UserTenantRoleRepository userTenantRoleRepository;

    @Mock
    private SiteAssignmentRepository siteAssignmentRepository;

    @Mock
    private ObjectRepository objectRepository;

    @InjectMocks
    private AuthService authService;

    private User systemAdmin;
    private User consultant;
    private User landlord;
    private User technician;
    private User viewer;

    @BeforeEach
    void setUp() {
        systemAdmin = createUser("system_admin");
        consultant = createUser("consultant");
        landlord = createUser("landlord");
        technician = createUser("technician");
        viewer = createUser("viewer");
    }

    private User createUser(String role) {
        User user = new User();
        user.setId(UUID.randomUUID());
        user.setSubject("local|" + UUID.randomUUID());
        user.setEmail(role + "@example.com");
        user.setGlobalRole(role);
        return user;
    }

    private void mockJwtAuthentication(String subject) {
        Jwt jwt = mock(Jwt.class);
        given(jwt.getSubject()).willReturn(subject);

        Authentication authentication = mock(Authentication.class);
        given(authentication.getPrincipal()).willReturn(jwt);

        SecurityContext securityContext = mock(SecurityContext.class);
        given(securityContext.getAuthentication()).willReturn(authentication);

        SecurityContextHolder.setContext(securityContext);
    }

    @Nested
    class GlobalRoleChecks {

        @Test
        void isSystemAdmin_WhenSystemAdmin_ReturnsTrue() {
            mockJwtAuthentication(systemAdmin.getSubject());
            given(userRepository.findBySubject(systemAdmin.getSubject()))
                    .willReturn(Optional.of(systemAdmin));

            assertThat(authService.isSystemAdmin()).isTrue();
        }

        @Test
        void isSystemAdmin_WhenConsultant_ReturnsFalse() {
            mockJwtAuthentication(consultant.getSubject());
            given(userRepository.findBySubject(consultant.getSubject()))
                    .willReturn(Optional.of(consultant));

            assertThat(authService.isSystemAdmin()).isFalse();
        }

        @Test
        void isConsultant_WhenConsultant_ReturnsTrue() {
            mockJwtAuthentication(consultant.getSubject());
            given(userRepository.findBySubject(consultant.getSubject()))
                    .willReturn(Optional.of(consultant));

            assertThat(authService.isConsultant()).isTrue();
        }

        @Test
        void isConsultant_WhenSystemAdmin_ReturnsTrue() {
            mockJwtAuthentication(systemAdmin.getSubject());
            given(userRepository.findBySubject(systemAdmin.getSubject()))
                    .willReturn(Optional.of(systemAdmin));

            assertThat(authService.isConsultant()).isTrue();
        }

        @Test
        void isConsultant_WhenLandlord_ReturnsFalse() {
            mockJwtAuthentication(landlord.getSubject());
            given(userRepository.findBySubject(landlord.getSubject()))
                    .willReturn(Optional.of(landlord));

            assertThat(authService.isConsultant()).isFalse();
        }

        @Test
        void isConsultantOrAdmin_WhenSystemAdmin_ReturnsTrue() {
            mockJwtAuthentication(systemAdmin.getSubject());
            given(userRepository.findBySubject(systemAdmin.getSubject()))
                    .willReturn(Optional.of(systemAdmin));

            assertThat(authService.isConsultantOrAdmin()).isTrue();
        }

        @Test
        void getCurrentGlobalRole_WhenNoUser_ReturnsViewer() {
            SecurityContext securityContext = mock(SecurityContext.class);
            given(securityContext.getAuthentication()).willReturn(null);
            SecurityContextHolder.setContext(securityContext);

            assertThat(authService.getCurrentGlobalRole()).isEqualTo(GlobalRole.VIEWER);
        }
    }

    @Nested
    class TenantAccessChecks {

        private UUID tenantId;

        @BeforeEach
        void setUp() {
            tenantId = UUID.randomUUID();
        }

        @Test
        void canAccessTenant_SystemAdmin_AlwaysTrue() {
            mockJwtAuthentication(systemAdmin.getSubject());
            given(userRepository.findBySubject(systemAdmin.getSubject()))
                    .willReturn(Optional.of(systemAdmin));

            assertThat(authService.canAccessTenant(tenantId)).isTrue();
        }

        @Test
        void canAccessTenant_WithTenantRole_ReturnsTrue() {
            mockJwtAuthentication(landlord.getSubject());
            given(userRepository.findBySubject(landlord.getSubject()))
                    .willReturn(Optional.of(landlord));

            UserTenantRole utr = new UserTenantRole();
            utr.setTenantRole("viewer");
            given(userTenantRoleRepository.findByUserIdAndTenantId(landlord.getId(), tenantId))
                    .willReturn(Optional.of(utr));

            assertThat(authService.canAccessTenant(tenantId)).isTrue();
        }

        @Test
        void canAccessTenant_NoTenantRole_ReturnsFalse() {
            mockJwtAuthentication(landlord.getSubject());
            given(userRepository.findBySubject(landlord.getSubject()))
                    .willReturn(Optional.of(landlord));
            given(userTenantRoleRepository.findByUserIdAndTenantId(landlord.getId(), tenantId))
                    .willReturn(Optional.empty());

            assertThat(authService.canAccessTenant(tenantId)).isFalse();
        }

        @Test
        void isManagerInTenant_WithManagerRole_ReturnsTrue() {
            mockJwtAuthentication(consultant.getSubject());
            given(userRepository.findBySubject(consultant.getSubject()))
                    .willReturn(Optional.of(consultant));

            UserTenantRole utr = new UserTenantRole();
            utr.setTenantRole("manager");
            given(userTenantRoleRepository.findByUserIdAndTenantId(consultant.getId(), tenantId))
                    .willReturn(Optional.of(utr));

            assertThat(authService.isManagerInTenant(tenantId)).isTrue();
        }

        @Test
        void isManagerInTenant_WithOwnerRole_ReturnsTrue() {
            mockJwtAuthentication(landlord.getSubject());
            given(userRepository.findBySubject(landlord.getSubject()))
                    .willReturn(Optional.of(landlord));

            UserTenantRole utr = new UserTenantRole();
            utr.setTenantRole("owner");
            given(userTenantRoleRepository.findByUserIdAndTenantId(landlord.getId(), tenantId))
                    .willReturn(Optional.of(utr));

            assertThat(authService.isManagerInTenant(tenantId)).isTrue();
        }

        @Test
        void isManagerInTenant_WithViewerRole_ReturnsFalse() {
            mockJwtAuthentication(landlord.getSubject());
            given(userRepository.findBySubject(landlord.getSubject()))
                    .willReturn(Optional.of(landlord));

            UserTenantRole utr = new UserTenantRole();
            utr.setTenantRole("viewer");
            given(userTenantRoleRepository.findByUserIdAndTenantId(landlord.getId(), tenantId))
                    .willReturn(Optional.of(utr));

            assertThat(authService.isManagerInTenant(tenantId)).isFalse();
        }

        @Test
        void getAccessibleTenantIds_SystemAdmin_ReturnsEmptyList() {
            mockJwtAuthentication(systemAdmin.getSubject());
            given(userRepository.findBySubject(systemAdmin.getSubject()))
                    .willReturn(Optional.of(systemAdmin));

            List<UUID> result = authService.getAccessibleTenantIds();

            // Empty list signals "no filter needed" for system admins
            assertThat(result).isEmpty();
        }

        @Test
        void getAccessibleTenantIds_RegularUser_ReturnsTenantIds() {
            mockJwtAuthentication(landlord.getSubject());
            given(userRepository.findBySubject(landlord.getSubject()))
                    .willReturn(Optional.of(landlord));

            UUID t1 = UUID.randomUUID();
            UUID t2 = UUID.randomUUID();
            given(userTenantRoleRepository.findTenantIdsByUserId(landlord.getId()))
                    .willReturn(List.of(t1, t2));

            List<UUID> result = authService.getAccessibleTenantIds();

            assertThat(result).containsExactly(t1, t2);
        }
    }

    @Nested
    class SiteAccessChecks {

        @Test
        void canAccessSite_SystemAdmin_AlwaysTrue() {
            mockJwtAuthentication(systemAdmin.getSubject());
            given(userRepository.findBySubject(systemAdmin.getSubject()))
                    .willReturn(Optional.of(systemAdmin));

            assertThat(authService.canAccessSite(UUID.randomUUID())).isTrue();
        }

        @Test
        void canAccessSite_ViaTenantAccess_ReturnsTrue() {
            UUID siteId = UUID.randomUUID();
            UUID tenantId = UUID.randomUUID();

            Tenant tenant = new Tenant();
            tenant.setId(tenantId);
            ObjectEntity obj = new ObjectEntity();
            obj.setId(siteId);
            obj.setTenant(tenant);

            mockJwtAuthentication(landlord.getSubject());
            given(userRepository.findBySubject(landlord.getSubject()))
                    .willReturn(Optional.of(landlord));
            given(objectRepository.findById(siteId)).willReturn(Optional.of(obj));

            UserTenantRole utr = new UserTenantRole();
            utr.setTenantRole("owner");
            given(userTenantRoleRepository.findByUserIdAndTenantId(landlord.getId(), tenantId))
                    .willReturn(Optional.of(utr));

            assertThat(authService.canAccessSite(siteId)).isTrue();
        }

        @Test
        void canAccessSite_ViaSiteAssignment_ReturnsTrue() {
            UUID siteId = UUID.randomUUID();
            UUID tenantId = UUID.randomUUID();

            Tenant tenant = new Tenant();
            tenant.setId(tenantId);
            ObjectEntity obj = new ObjectEntity();
            obj.setId(siteId);
            obj.setTenant(tenant);

            mockJwtAuthentication(technician.getSubject());
            given(userRepository.findBySubject(technician.getSubject()))
                    .willReturn(Optional.of(technician));
            given(objectRepository.findById(siteId)).willReturn(Optional.of(obj));
            given(userTenantRoleRepository.findByUserIdAndTenantId(technician.getId(), tenantId))
                    .willReturn(Optional.empty());
            given(siteAssignmentRepository.existsByUserIdAndSiteId(technician.getId(), siteId))
                    .willReturn(true);

            assertThat(authService.canAccessSite(siteId)).isTrue();
        }

        @Test
        void canAccessSite_NoAccess_ReturnsFalse() {
            UUID siteId = UUID.randomUUID();
            UUID tenantId = UUID.randomUUID();

            Tenant tenant = new Tenant();
            tenant.setId(tenantId);
            ObjectEntity obj = new ObjectEntity();
            obj.setId(siteId);
            obj.setTenant(tenant);

            mockJwtAuthentication(viewer.getSubject());
            given(userRepository.findBySubject(viewer.getSubject()))
                    .willReturn(Optional.of(viewer));
            given(objectRepository.findById(siteId)).willReturn(Optional.of(obj));
            given(userTenantRoleRepository.findByUserIdAndTenantId(viewer.getId(), tenantId))
                    .willReturn(Optional.empty());
            given(siteAssignmentRepository.existsByUserIdAndSiteId(viewer.getId(), siteId))
                    .willReturn(false);

            assertThat(authService.canAccessSite(siteId)).isFalse();
        }

        @Test
        void canAccessSite_SiteNotFound_ReturnsFalse() {
            UUID siteId = UUID.randomUUID();

            mockJwtAuthentication(landlord.getSubject());
            given(userRepository.findBySubject(landlord.getSubject()))
                    .willReturn(Optional.of(landlord));
            given(objectRepository.findById(siteId)).willReturn(Optional.empty());

            assertThat(authService.canAccessSite(siteId)).isFalse();
        }

        @Test
        void getAccessibleSiteIds_SystemAdmin_ReturnsNull() {
            mockJwtAuthentication(systemAdmin.getSubject());
            given(userRepository.findBySubject(systemAdmin.getSubject()))
                    .willReturn(Optional.of(systemAdmin));

            // null means "no filter needed"
            assertThat(authService.getAccessibleSiteIds()).isNull();
        }

        @Test
        void getAccessibleSiteIds_Technician_CombinesAssignmentsAndTenantSites() {
            mockJwtAuthentication(technician.getSubject());
            given(userRepository.findBySubject(technician.getSubject()))
                    .willReturn(Optional.of(technician));

            UUID assignedSite = UUID.randomUUID();
            UUID tenantSite = UUID.randomUUID();
            UUID tenantId = UUID.randomUUID();

            given(siteAssignmentRepository.findSiteIdsByUserId(technician.getId()))
                    .willReturn(List.of(assignedSite));
            given(userTenantRoleRepository.findTenantIdsByUserId(technician.getId()))
                    .willReturn(List.of(tenantId));
            given(objectRepository.findIdsByTenantIdsAndObjectTypeName(
                    List.of(tenantId), OntologyService.BUILDING))
                    .willReturn(List.of(tenantSite));

            List<UUID> result = authService.getAccessibleSiteIds();

            assertThat(result).containsExactlyInAnyOrder(assignedSite, tenantSite);
        }
    }

    @Nested
    class UserProvisioning {

        @Test
        void getOrProvisionCurrentUser_ExistingUser_UpdatesLastLogin() {
            User existing = createUser("landlord");
            existing.setLastLoginAt(Instant.now().minus(1, java.time.temporal.ChronoUnit.DAYS));

            mockJwtAuthentication(existing.getSubject());
            given(userRepository.findBySubject(existing.getSubject()))
                    .willReturn(Optional.of(existing));
            given(userRepository.save(any(User.class))).willAnswer(inv -> inv.getArgument(0));

            User result = authService.getOrProvisionCurrentUser();

            assertThat(result.getLastLoginAt()).isAfter(Instant.now().minusSeconds(5));
            verify(userRepository).save(existing);
        }

        @Test
        void getOrProvisionCurrentUser_NewUser_CreatesWithViewerRole() {
            String subject = "local|new-user";
            mockJwtAuthentication(subject);

            Jwt jwt = (Jwt) SecurityContextHolder.getContext().getAuthentication().getPrincipal();
            given(jwt.getClaimAsString("email")).willReturn("new@example.com");
            given(jwt.getClaimAsString("name")).willReturn("New User");
            given(jwt.getClaimAsString("picture")).willReturn("https://example.com/avatar.jpg");

            given(userRepository.findBySubject(subject)).willReturn(Optional.empty());
            given(userRepository.findByEmail("new@example.com")).willReturn(Optional.empty());
            given(userRepository.save(any(User.class))).willAnswer(inv -> {
                User u = inv.getArgument(0);
                u.setId(UUID.randomUUID());
                return u;
            });

            User result = authService.getOrProvisionCurrentUser();

            assertThat(result.getSubject()).isEqualTo(subject);
            assertThat(result.getEmail()).isEqualTo("new@example.com");
            assertThat(result.getDisplayName()).isEqualTo("New User");
            assertThat(result.getAvatarUrl()).isEqualTo("https://example.com/avatar.jpg");
            assertThat(result.getGlobalRole()).isEqualTo("viewer");
            assertThat(result.getCreatedAt()).isNotNull();
            assertThat(result.getLastLoginAt()).isNotNull();
        }

        @Test
        void getOrProvisionCurrentUser_SubjectChanged_LinksViaEmail() {
            // Existing user has old subject
            User existing = createUser("consultant");
            String oldSub = existing.getSubject();
            String newSub = "google-oauth2|" + UUID.randomUUID();

            mockJwtAuthentication(newSub);
            Jwt jwt = (Jwt) SecurityContextHolder.getContext().getAuthentication().getPrincipal();
            given(jwt.getClaimAsString("email")).willReturn(existing.getEmail());
            given(jwt.getClaimAsString("name")).willReturn("Updated Name");
            given(jwt.getClaimAsString("picture")).willReturn("https://example.com/new-avatar.jpg");

            // subject lookup fails (new sub)
            given(userRepository.findBySubject(newSub)).willReturn(Optional.empty());
            // email fallback finds the existing user
            given(userRepository.findByEmail(existing.getEmail())).willReturn(Optional.of(existing));
            given(userRepository.save(any(User.class))).willAnswer(inv -> inv.getArgument(0));

            User result = authService.getOrProvisionCurrentUser();

            // Should reuse the existing user, not create a new one
            assertThat(result.getId()).isEqualTo(existing.getId());
            assertThat(result.getSubject()).isEqualTo(newSub); // linked to new sub
            assertThat(result.getGlobalRole()).isEqualTo("consultant"); // preserved role
            assertThat(result.getDisplayName()).isEqualTo("Updated Name");
            assertThat(result.getLastLoginAt()).isAfter(Instant.now().minusSeconds(5));
            verify(userRepository, times(1)).save(existing);
        }

        @Test
        void getOrProvisionCurrentUser_NoAuthentication_Throws() {
            SecurityContext securityContext = mock(SecurityContext.class);
            given(securityContext.getAuthentication()).willReturn(null);
            SecurityContextHolder.setContext(securityContext);

            assertThatThrownBy(() -> authService.getOrProvisionCurrentUser())
                    .isInstanceOf(SecurityException.class)
                    .hasMessageContaining("No authenticated user");
        }
    }

    @Nested
    class AddUserToTenant {

        @Test
        void shouldCreateTenantMembership() {
            User user = createUser("landlord");
            Tenant tenant = new Tenant();
            tenant.setId(UUID.randomUUID());
            tenant.setName("Test");

            given(userTenantRoleRepository.save(any(UserTenantRole.class))).willAnswer(inv -> {
                UserTenantRole utr = inv.getArgument(0);
                utr.setId(UUID.randomUUID());
                return utr;
            });

            UserTenantRole result = authService.addUserToTenant(user, tenant, TenantRole.OWNER);

            assertThat(result.getUser()).isEqualTo(user);
            assertThat(result.getTenant()).isEqualTo(tenant);
            assertThat(result.getTenantRole()).isEqualTo("owner");
            assertThat(result.getCreatedAt()).isNotNull();
        }
    }
}
