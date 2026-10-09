package com.heatingplatform.core.privacy;

import com.heatingplatform.core.user.AuthService;
import com.heatingplatform.core.user.TenantRole;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * Authorisation contract of the privacy endpoints: manager-in-tenant for
 * residents, system admin for users, and an explicit 403 on denial so the
 * AccessAuditFilter records the attempt (QS-SEC-01 meets QS-SEC-02).
 */
@ExtendWith(MockitoExtension.class)
class PrivacyControllerTest {

    @Mock
    private PersonPrivacyService personPrivacyService;
    @Mock
    private UserPrivacyService userPrivacyService;
    @Mock
    private AuthService authService;

    @InjectMocks
    private PrivacyController controller;

    private final UUID personId = UUID.randomUUID();
    private final UUID tenantId = UUID.randomUUID();
    private final UUID userId = UUID.randomUUID();

    @Test
    void person_export_requires_the_manager_role_in_the_owning_tenant() {
        given(personPrivacyService.tenantOf(personId)).willReturn(tenantId);
        given(authService.hasRoleInTenant(tenantId, TenantRole.MANAGER)).willReturn(false);

        ResponseEntity<?> response = controller.exportPerson(personId);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        verify(personPrivacyService, never()).export(personId);
    }

    @Test
    void person_export_answers_for_the_tenant_manager() {
        given(personPrivacyService.tenantOf(personId)).willReturn(tenantId);
        given(authService.hasRoleInTenant(tenantId, TenantRole.MANAGER)).willReturn(true);
        given(personPrivacyService.export(personId)).willReturn(
                new PersonPrivacyService.PersonExport(personId, "Erika", tenantId,
                        Map.of(), List.of(), List.of(), List.of()));

        ResponseEntity<?> response = controller.exportPerson(personId);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    @Test
    void person_erasure_is_denied_with_an_explicit_403() {
        given(personPrivacyService.tenantOf(personId)).willReturn(tenantId);
        given(authService.hasRoleInTenant(tenantId, TenantRole.MANAGER)).willReturn(false);

        ResponseEntity<?> response = controller.erasePerson(personId);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        verify(personPrivacyService, never()).erase(personId);
    }

    /** Tenant-less system objects belong to nobody's mandate but the admin's. */
    @Test
    void a_tenantless_person_is_admin_territory() {
        given(personPrivacyService.tenantOf(personId)).willReturn(null);
        given(authService.isSystemAdmin()).willReturn(false);

        assertThat(controller.exportPerson(personId).getStatusCode())
                .isEqualTo(HttpStatus.FORBIDDEN);
    }

    @Test
    void user_endpoints_require_the_system_admin() {
        given(authService.isSystemAdmin()).willReturn(false);

        assertThat(controller.exportUser(userId).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(controller.eraseUser(userId).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        verify(userPrivacyService, never()).export(userId);
        verify(userPrivacyService, never()).erase(userId);
    }

    @Test
    void user_erasure_runs_for_the_system_admin() {
        given(authService.isSystemAdmin()).willReturn(true);
        given(userPrivacyService.erase(userId)).willReturn(
                new UserPrivacyService.ErasureReport(userId, 0, 0, 0, 0, "note"));

        assertThat(controller.eraseUser(userId).getStatusCode()).isEqualTo(HttpStatus.OK);
        verify(userPrivacyService).erase(userId);
    }
}
