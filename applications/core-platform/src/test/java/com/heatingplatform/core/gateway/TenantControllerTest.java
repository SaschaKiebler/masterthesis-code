package com.heatingplatform.core.gateway;

import com.heatingplatform.core.tenant.Tenant;
import com.heatingplatform.core.tenant.TenantController;
import com.heatingplatform.core.user.User;
import com.heatingplatform.core.user.UserTenantRole;
import com.heatingplatform.core.user.TenantRole;
import com.heatingplatform.core.tenant.TenantRepository;
import com.heatingplatform.core.user.UserRepository;
import com.heatingplatform.core.user.UserTenantRoleRepository;
import com.heatingplatform.core.user.AuthService;
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
import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class TenantControllerTest {

    @Mock
    private TenantRepository tenantRepository;

    @Mock
    private UserRepository userRepository;

    @Mock
    private UserTenantRoleRepository userTenantRoleRepository;

    @Mock
    private AuthService authService;

    @InjectMocks
    private TenantController tenantController;

    private Tenant tenant;
    private User manager;
    private User member;

    @BeforeEach
    void setUp() {
        tenant = new Tenant();
        tenant.setId(UUID.randomUUID());
        tenant.setName("Test Tenant");
        tenant.setType("standard");
        tenant.setStatus("active");
        tenant.setCreatedAt(Instant.now());

        manager = new User();
        manager.setId(UUID.randomUUID());
        manager.setEmail("manager@example.com");
        manager.setDisplayName("Manager");
        manager.setGlobalRole("consultant");

        member = new User();
        member.setId(UUID.randomUUID());
        member.setEmail("member@example.com");
        member.setDisplayName("Member");
        member.setGlobalRole("landlord");
    }

    @Nested
    class ListTenants {

        @Test
        void systemAdmin_ShouldSeeAllTenants() {
            given(authService.isSystemAdmin()).willReturn(true);
            given(tenantRepository.findAll()).willReturn(List.of(tenant));

            ResponseEntity<Map<String, Object>> response = tenantController.listTenants();

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> tenants = (List<Map<String, Object>>) response.getBody().get("tenants");
            assertThat(tenants).hasSize(1);
            assertThat(tenants.get(0).get("name")).isEqualTo("Test Tenant");
        }

        @Test
        void regularUser_ShouldOnlySeeAccessibleTenants() {
            given(authService.isSystemAdmin()).willReturn(false);
            given(authService.getAccessibleTenantIds()).willReturn(List.of(tenant.getId()));
            given(tenantRepository.findAllById(List.of(tenant.getId()))).willReturn(List.of(tenant));

            ResponseEntity<Map<String, Object>> response = tenantController.listTenants();

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
            verify(tenantRepository, never()).findAll();
        }

        @Test
        void regularUserWithNoTenants_ShouldReturnEmpty() {
            given(authService.isSystemAdmin()).willReturn(false);
            given(authService.getAccessibleTenantIds()).willReturn(List.of());

            ResponseEntity<Map<String, Object>> response = tenantController.listTenants();

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
            @SuppressWarnings("unchecked")
            List<?> tenants = (List<?>) response.getBody().get("tenants");
            assertThat(tenants).isEmpty();
        }
    }

    @Nested
    class CreateTenant {

        @Test
        void shouldCreateTenantAndAssignCreatorAsManager() {
            given(authService.isConsultantOrAdmin()).willReturn(true);
            given(authService.getOrProvisionCurrentUser()).willReturn(manager);
            given(tenantRepository.save(any(Tenant.class))).willAnswer(inv -> {
                Tenant t = inv.getArgument(0);
                t.setId(UUID.randomUUID());
                return t;
            });

            ResponseEntity<Map<String, Object>> response = tenantController.createTenant(
                    Map.of("name", "New Tenant"));

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);
            verify(authService).addUserToTenant(eq(manager), any(Tenant.class), eq(TenantRole.MANAGER));
        }

        @Test
        void shouldReturn403ForNonConsultant() {
            given(authService.isConsultantOrAdmin()).willReturn(false);

            ResponseEntity<Map<String, Object>> response = tenantController.createTenant(
                    Map.of("name", "New Tenant"));

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
            verify(tenantRepository, never()).save(any());
        }
    }

    @Nested
    class ListMembers {

        @Test
        void shouldReturnMembersWhenManager() {
            given(authService.isManagerInTenant(tenant.getId())).willReturn(true);
            given(tenantRepository.findById(tenant.getId())).willReturn(Optional.of(tenant));

            UserTenantRole utr = new UserTenantRole();
            utr.setUser(member);
            utr.setTenant(tenant);
            utr.setTenantRole("owner");
            utr.setCreatedAt(Instant.now());
            given(userTenantRoleRepository.findByTenantId(tenant.getId())).willReturn(List.of(utr));

            ResponseEntity<Map<String, Object>> response =
                    tenantController.listMembers(tenant.getId().toString());

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> members = (List<Map<String, Object>>) response.getBody().get("members");
            assertThat(members).hasSize(1);
            assertThat(members.get(0).get("email")).isEqualTo("member@example.com");
            assertThat(members.get(0).get("tenantRole")).isEqualTo("owner");
        }

        @Test
        void shouldReturn403WhenNotManager() {
            given(authService.isManagerInTenant(tenant.getId())).willReturn(false);

            ResponseEntity<Map<String, Object>> response =
                    tenantController.listMembers(tenant.getId().toString());

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        }
    }

    @Nested
    class AddMember {

        @Test
        void shouldAddMemberWithRole() {
            given(authService.isManagerInTenant(tenant.getId())).willReturn(true);
            given(tenantRepository.findById(tenant.getId())).willReturn(Optional.of(tenant));
            given(userRepository.findById(member.getId())).willReturn(Optional.of(member));
            given(userTenantRoleRepository.findByUserIdAndTenantId(member.getId(), tenant.getId()))
                    .willReturn(Optional.empty());

            UserTenantRole newUtr = new UserTenantRole();
            newUtr.setId(UUID.randomUUID());
            newUtr.setUser(member);
            newUtr.setTenant(tenant);
            newUtr.setTenantRole("owner");
            newUtr.setCreatedAt(Instant.now());
            given(authService.addUserToTenant(member, tenant, TenantRole.OWNER)).willReturn(newUtr);

            ResponseEntity<Map<String, Object>> response = tenantController.addMember(
                    tenant.getId().toString(),
                    Map.of("userId", member.getId().toString(), "tenantRole", "owner"));

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);
            @SuppressWarnings("unchecked")
            Map<String, Object> memberMap = (Map<String, Object>) response.getBody().get("member");
            assertThat(memberMap.get("tenantRole")).isEqualTo("owner");
        }

        @Test
        void shouldReturn409WhenAlreadyMember() {
            given(authService.isManagerInTenant(tenant.getId())).willReturn(true);
            given(tenantRepository.findById(tenant.getId())).willReturn(Optional.of(tenant));
            given(userRepository.findById(member.getId())).willReturn(Optional.of(member));

            UserTenantRole existing = new UserTenantRole();
            given(userTenantRoleRepository.findByUserIdAndTenantId(member.getId(), tenant.getId()))
                    .willReturn(Optional.of(existing));

            ResponseEntity<Map<String, Object>> response = tenantController.addMember(
                    tenant.getId().toString(),
                    Map.of("userId", member.getId().toString(), "tenantRole", "viewer"));

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        }

        @Test
        void shouldReturn403WhenNotManager() {
            given(authService.isManagerInTenant(tenant.getId())).willReturn(false);

            ResponseEntity<Map<String, Object>> response = tenantController.addMember(
                    tenant.getId().toString(),
                    Map.of("userId", member.getId().toString(), "tenantRole", "viewer"));

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        }
    }

    @Nested
    class UpdateMemberRole {

        @Test
        void shouldUpdateRole() {
            given(authService.isManagerInTenant(tenant.getId())).willReturn(true);

            UserTenantRole utr = new UserTenantRole();
            utr.setId(UUID.randomUUID());
            utr.setUser(member);
            utr.setTenant(tenant);
            utr.setTenantRole("viewer");
            utr.setCreatedAt(Instant.now());
            given(userTenantRoleRepository.findByUserIdAndTenantId(member.getId(), tenant.getId()))
                    .willReturn(Optional.of(utr));
            given(userTenantRoleRepository.save(any(UserTenantRole.class))).willAnswer(inv -> inv.getArgument(0));

            ResponseEntity<Map<String, Object>> response = tenantController.updateMemberRole(
                    tenant.getId().toString(), member.getId().toString(),
                    Map.of("tenantRole", "manager"));

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
            assertThat(utr.getTenantRole()).isEqualTo("manager");
        }
    }

    @Nested
    class RemoveMember {

        @Test
        void shouldRemoveMember() {
            given(authService.isManagerInTenant(tenant.getId())).willReturn(true);

            UserTenantRole utr = new UserTenantRole();
            utr.setId(UUID.randomUUID());
            utr.setUser(member);
            utr.setTenant(tenant);
            utr.setTenantRole("viewer");
            given(userTenantRoleRepository.findByUserIdAndTenantId(member.getId(), tenant.getId()))
                    .willReturn(Optional.of(utr));

            ResponseEntity<Map<String, Object>> response = tenantController.removeMember(
                    tenant.getId().toString(), member.getId().toString());

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
            verify(userTenantRoleRepository).delete(utr);
        }

        @Test
        void shouldPreventRemovingLastManager() {
            given(authService.isManagerInTenant(tenant.getId())).willReturn(true);

            UserTenantRole managerUtr = new UserTenantRole();
            managerUtr.setId(UUID.randomUUID());
            managerUtr.setUser(manager);
            managerUtr.setTenant(tenant);
            managerUtr.setTenantRole("manager");
            given(userTenantRoleRepository.findByUserIdAndTenantId(manager.getId(), tenant.getId()))
                    .willReturn(Optional.of(managerUtr));
            given(userTenantRoleRepository.findByTenantId(tenant.getId()))
                    .willReturn(List.of(managerUtr));

            ResponseEntity<Map<String, Object>> response = tenantController.removeMember(
                    tenant.getId().toString(), manager.getId().toString());

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
            assertThat(response.getBody().get("message").toString())
                    .contains("Cannot remove the last manager");
            verify(userTenantRoleRepository, never()).delete(any());
        }

        @Test
        void shouldAllowRemovingManagerWhenOtherManagersExist() {
            given(authService.isManagerInTenant(tenant.getId())).willReturn(true);

            User otherManager = new User();
            otherManager.setId(UUID.randomUUID());
            otherManager.setGlobalRole("consultant");

            UserTenantRole utr1 = new UserTenantRole();
            utr1.setUser(manager);
            utr1.setTenant(tenant);
            utr1.setTenantRole("manager");

            UserTenantRole utr2 = new UserTenantRole();
            utr2.setUser(otherManager);
            utr2.setTenant(tenant);
            utr2.setTenantRole("manager");

            given(userTenantRoleRepository.findByUserIdAndTenantId(manager.getId(), tenant.getId()))
                    .willReturn(Optional.of(utr1));
            given(userTenantRoleRepository.findByTenantId(tenant.getId()))
                    .willReturn(List.of(utr1, utr2));

            ResponseEntity<Map<String, Object>> response = tenantController.removeMember(
                    tenant.getId().toString(), manager.getId().toString());

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
            verify(userTenantRoleRepository).delete(utr1);
        }
    }
}
