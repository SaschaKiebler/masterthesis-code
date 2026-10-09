package com.heatingplatform.core.gateway;

import com.heatingplatform.core.user.UserController;

import com.heatingplatform.core.user.GlobalRole;
import com.heatingplatform.core.user.User;
import com.heatingplatform.core.user.UserTenantRole;
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
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import java.time.Instant;
import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class UserControllerTest {

    @Mock
    private UserRepository userRepository;

    @Mock
    private UserTenantRoleRepository userTenantRoleRepository;

    @Mock
    private AuthService authService;

    @InjectMocks
    private UserController userController;

    private User adminUser;
    private User targetUser;

    @BeforeEach
    void setUp() {
        adminUser = new User();
        adminUser.setId(UUID.randomUUID());
        adminUser.setEmail("admin@example.com");
        adminUser.setGlobalRole("system_admin");
        adminUser.setCreatedAt(Instant.now());

        targetUser = new User();
        targetUser.setId(UUID.randomUUID());
        targetUser.setSubject("local|target-user-123");
        targetUser.setEmail("user@example.com");
        targetUser.setDisplayName("Test User");
        targetUser.setGlobalRole("viewer");
        targetUser.setCreatedAt(Instant.now());
        targetUser.setTenantRoles(new ArrayList<>());
    }

    @Nested
    class ListUsers {

        @Test
        void shouldReturnUsersWhenAdmin() {
            given(authService.isSystemAdmin()).willReturn(true);

            Page<User> page = new PageImpl<>(List.of(targetUser));
            given(userRepository.findAll(any(Pageable.class))).willReturn(page);

            ResponseEntity<Map<String, Object>> response = userController.listUsers(1, 20, null, null);

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> users = (List<Map<String, Object>>) response.getBody().get("users");
            assertThat(users).hasSize(1);
            assertThat(users.get(0).get("email")).isEqualTo("user@example.com");
        }

        @Test
        void shouldFilterByRoleWhenProvided() {
            given(authService.isSystemAdmin()).willReturn(true);

            Page<User> page = new PageImpl<>(List.of(targetUser));
            given(userRepository.findByGlobalRole(eq("viewer"), any(Pageable.class))).willReturn(page);

            ResponseEntity<Map<String, Object>> response = userController.listUsers(1, 20, "viewer", null);

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
            verify(userRepository).findByGlobalRole(eq("viewer"), any(Pageable.class));
            verify(userRepository, never()).findAll(any(Pageable.class));
        }

        @Test
        void shouldSearchWhenQueryProvided() {
            given(authService.isSystemAdmin()).willReturn(true);

            Page<User> page = new PageImpl<>(List.of(targetUser));
            given(userRepository.searchByEmailOrDisplayName(eq("test"), any(Pageable.class))).willReturn(page);

            ResponseEntity<Map<String, Object>> response = userController.listUsers(1, 20, null, "test");

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
            verify(userRepository).searchByEmailOrDisplayName(eq("test"), any(Pageable.class));
        }

        @Test
        void shouldReturn403WhenNotAdmin() {
            given(authService.isSystemAdmin()).willReturn(false);

            ResponseEntity<Map<String, Object>> response = userController.listUsers(1, 20, null, null);

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
            verify(userRepository, never()).findAll(any(Pageable.class));
        }

        @Test
        void shouldCapPageSizeAt100() {
            given(authService.isSystemAdmin()).willReturn(true);

            Page<User> page = new PageImpl<>(List.of());
            given(userRepository.findAll(any(Pageable.class))).willReturn(page);

            userController.listUsers(1, 500, null, null);

            verify(userRepository).findAll(argThat((Pageable p) -> p.getPageSize() == 100));
        }
    }

    @Nested
    class GetUser {

        @Test
        void shouldReturnUserDetailWhenAdmin() {
            given(authService.isSystemAdmin()).willReturn(true);
            given(userRepository.findById(targetUser.getId())).willReturn(Optional.of(targetUser));
            given(userTenantRoleRepository.findByUserId(targetUser.getId())).willReturn(List.of());

            ResponseEntity<Map<String, Object>> response =
                    userController.getUser(targetUser.getId().toString());

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
            @SuppressWarnings("unchecked")
            Map<String, Object> user = (Map<String, Object>) response.getBody().get("user");
            assertThat(user.get("email")).isEqualTo("user@example.com");
            assertThat(user.get("subject")).isNotNull();
        }

        @Test
        void shouldReturn403WhenNotAdmin() {
            given(authService.isSystemAdmin()).willReturn(false);

            ResponseEntity<Map<String, Object>> response =
                    userController.getUser(targetUser.getId().toString());

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        }
    }

    @Nested
    class UpdateUser {

        @Test
        void shouldUpdateGlobalRole() {
            given(authService.isSystemAdmin()).willReturn(true);
            given(authService.getOrProvisionCurrentUser()).willReturn(adminUser);
            given(userRepository.findById(targetUser.getId())).willReturn(Optional.of(targetUser));
            given(userRepository.save(any(User.class))).willAnswer(inv -> inv.getArgument(0));

            ResponseEntity<Map<String, Object>> response = userController.updateUser(
                    targetUser.getId().toString(),
                    Map.of("globalRole", "consultant"));

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
            assertThat(targetUser.getGlobalRole()).isEqualTo("consultant");
        }

        @Test
        void shouldPreventSelfRoleChange() {
            given(authService.isSystemAdmin()).willReturn(true);
            given(authService.getOrProvisionCurrentUser()).willReturn(adminUser);

            ResponseEntity<Map<String, Object>> response = userController.updateUser(
                    adminUser.getId().toString(),
                    Map.of("globalRole", "viewer"));

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
            assertThat(response.getBody().get("message").toString())
                    .contains("Cannot change your own global role");
            verify(userRepository, never()).save(any());
        }

        @Test
        void shouldReturn403WhenNotAdmin() {
            given(authService.isSystemAdmin()).willReturn(false);

            ResponseEntity<Map<String, Object>> response = userController.updateUser(
                    targetUser.getId().toString(),
                    Map.of("globalRole", "consultant"));

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        }
    }

    @Nested
    class DeleteUser {

        @Test
        void shouldDeactivateUserAndRemoveTenantRoles() {
            given(authService.isSystemAdmin()).willReturn(true);
            given(authService.getOrProvisionCurrentUser()).willReturn(adminUser);
            given(userRepository.findById(targetUser.getId())).willReturn(Optional.of(targetUser));

            UserTenantRole utr = new UserTenantRole();
            utr.setId(UUID.randomUUID());
            given(userTenantRoleRepository.findByUserId(targetUser.getId())).willReturn(List.of(utr));

            ResponseEntity<Map<String, Object>> response =
                    userController.deleteUser(targetUser.getId().toString());

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
            verify(userTenantRoleRepository).deleteAll(List.of(utr));
            assertThat(targetUser.getGlobalRole()).isEqualTo("viewer");
            verify(userRepository).save(targetUser);
        }

        @Test
        void shouldPreventSelfDeletion() {
            given(authService.isSystemAdmin()).willReturn(true);
            given(authService.getOrProvisionCurrentUser()).willReturn(adminUser);

            ResponseEntity<Map<String, Object>> response =
                    userController.deleteUser(adminUser.getId().toString());

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
            verify(userRepository, never()).save(any());
        }
    }
}
