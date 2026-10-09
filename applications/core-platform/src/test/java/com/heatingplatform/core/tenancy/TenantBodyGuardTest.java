package com.heatingplatform.core.tenancy;

import com.heatingplatform.core.site.SiteAssignmentRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.BDDMockito.given;

/**
 * The guard's contract: the interceptor's decision table, applied to ids the
 * interceptor never sees. Same lookup, same membership, same evaluator, so a
 * body id and a URL id can never be judged differently.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class TenantBodyGuardTest {

    private static final UUID OWN_TENANT = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID FOREIGN_TENANT = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID USER_ID = UUID.fromString("33333333-3333-3333-3333-333333333333");
    private static final UUID OWN_SITE = UUID.fromString("44444444-4444-4444-4444-444444444444");
    private static final UUID FOREIGN_SITE = UUID.fromString("55555555-5555-5555-5555-555555555555");
    private static final UUID GLOBAL_OBJECT = UUID.fromString("66666666-6666-6666-6666-666666666666");
    private static final String SUBJECT = "local|erika";

    @Mock
    private TenantOwnershipLookup ownershipLookup;
    @Mock
    private TenantMembershipService membershipService;
    /** The evaluator consults site assignments for a refused OBJECT; none here. */
    @Mock
    private SiteAssignmentRepository siteAssignmentRepository;

    private TenantEnforcementProperties properties;
    private TenantBodyGuard guard;
    private MockHttpServletRequest request;

    @BeforeEach
    void setUp() {
        properties = new TenantEnforcementProperties();
        properties.setMode(TenantEnforcementProperties.Mode.ENFORCE);
        guard = new TenantBodyGuard(ownershipLookup, membershipService,
                new TenantAccessEvaluator(siteAssignmentRepository), properties);

        given(membershipService.forSubject(SUBJECT))
                .willReturn(new Membership(USER_ID, Set.of(OWN_TENANT), false, 0L));
        given(ownershipLookup.resolve(ResourceKind.OBJECT, OWN_SITE))
                .willReturn(TenantScope.resolved(ResourceKind.OBJECT, OWN_SITE, OWN_TENANT));
        given(ownershipLookup.resolve(ResourceKind.OBJECT, FOREIGN_SITE))
                .willReturn(TenantScope.resolved(ResourceKind.OBJECT, FOREIGN_SITE, FOREIGN_TENANT));
        given(ownershipLookup.resolve(ResourceKind.OBJECT, GLOBAL_OBJECT))
                .willReturn(TenantScope.global(ResourceKind.OBJECT, GLOBAL_OBJECT));
        given(ownershipLookup.resolve(ResourceKind.TENANT, OWN_TENANT))
                .willReturn(TenantScope.resolved(ResourceKind.TENANT, OWN_TENANT, OWN_TENANT));
        given(ownershipLookup.resolve(ResourceKind.TENANT, FOREIGN_TENANT))
                .willReturn(TenantScope.resolved(ResourceKind.TENANT, FOREIGN_TENANT, FOREIGN_TENANT));

        request = new MockHttpServletRequest("POST", "/api/v1/projects/x/sites");
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
        authenticateAs(SUBJECT);
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
        RequestContextHolder.resetRequestAttributes();
    }

    @Test
    void own_resource_passes() {
        assertThatCode(() -> guard.requireAccess(ResourceKind.OBJECT, OWN_SITE))
                .doesNotThrowAnyException();
    }

    @Test
    void foreign_resource_is_refused_and_the_audit_filter_learns_the_tenant() {
        assertThatThrownBy(() -> guard.requireAccess(ResourceKind.OBJECT, FOREIGN_SITE))
                .isInstanceOf(CrossTenantAccessException.class);

        Object attribute = request.getAttribute(TenantScopeAttribute.KEY);
        assertThat(attribute).isInstanceOf(TenantScopeAttribute.class);
        TenantScopeAttribute scope = (TenantScopeAttribute) attribute;
        assertThat(scope.denied()).isTrue();
        assertThat(scope.effectiveTenant()).isEqualTo(FOREIGN_TENANT);
    }

    @Test
    void one_foreign_id_in_a_list_refuses_the_whole_list() {
        assertThatThrownBy(() -> guard.requireAccessToAll(ResourceKind.OBJECT,
                List.of(OWN_SITE, FOREIGN_SITE)))
                .isInstanceOf(CrossTenantAccessException.class);
    }

    /** A write may not touch shared data, but a reference to it is a read. */
    @Test
    void a_global_object_can_be_referenced_but_not_written() {
        assertThatThrownBy(() -> guard.requireAccess(ResourceKind.OBJECT, GLOBAL_OBJECT))
                .isInstanceOf(CrossTenantAccessException.class);
        assertThatCode(() -> guard.requireReference(ResourceKind.OBJECT, GLOBAL_OBJECT))
                .doesNotThrowAnyException();
    }

    @Test
    void a_reference_to_a_foreign_object_is_still_refused() {
        assertThatThrownBy(() -> guard.requireReference(ResourceKind.OBJECT, FOREIGN_SITE))
                .isInstanceOf(CrossTenantAccessException.class);
    }

    @Test
    void body_tenant_must_be_one_of_the_callers() {
        assertThatCode(() -> guard.requireTenant(OWN_TENANT)).doesNotThrowAnyException();
        assertThatThrownBy(() -> guard.requireTenant(FOREIGN_TENANT))
                .isInstanceOf(CrossTenantAccessException.class);
    }

    @Test
    void a_system_wide_write_needs_a_system_admin() {
        assertThatThrownBy(() -> guard.requireTenantOrSystem(null))
                .isInstanceOf(CrossTenantAccessException.class);

        given(membershipService.forSubject(SUBJECT))
                .willReturn(new Membership(USER_ID, Set.of(), true, 0L));
        assertThatCode(() -> guard.requireTenantOrSystem(null)).doesNotThrowAnyException();
    }

    @Test
    void unknown_ids_are_left_to_the_handler() {
        UUID unknown = UUID.randomUUID();
        given(ownershipLookup.resolve(ResourceKind.OBJECT, unknown))
                .willReturn(TenantScope.unknown(ResourceKind.OBJECT, unknown));
        assertThatCode(() -> guard.requireAccess(ResourceKind.OBJECT, unknown))
                .doesNotThrowAnyException();
    }

    @Test
    void system_admins_are_never_refused() {
        given(membershipService.forSubject(SUBJECT))
                .willReturn(new Membership(USER_ID, Set.of(), true, 0L));
        assertThatCode(() -> guard.requireAccess(ResourceKind.OBJECT, FOREIGN_SITE))
                .doesNotThrowAnyException();
    }

    @Test
    void observe_mode_records_but_does_not_refuse() {
        properties.setMode(TenantEnforcementProperties.Mode.OBSERVE);
        assertThatCode(() -> guard.requireAccess(ResourceKind.OBJECT, FOREIGN_SITE))
                .doesNotThrowAnyException();
        assertThat(request.getAttribute(TenantScopeAttribute.KEY))
                .isInstanceOf(TenantScopeAttribute.class);
    }

    @Test
    void off_mode_does_nothing() {
        properties.setMode(TenantEnforcementProperties.Mode.OFF);
        assertThatCode(() -> guard.requireAccess(ResourceKind.OBJECT, FOREIGN_SITE))
                .doesNotThrowAnyException();
    }

    @Test
    void null_ids_are_ignored() {
        assertThatCode(() -> {
            guard.requireAccess(ResourceKind.OBJECT, null);
            guard.requireTenant(null);
            guard.requireAccessToAll(ResourceKind.OBJECT, null);
        }).doesNotThrowAnyException();
    }

    private static void authenticateAs(String subject) {
        Jwt jwt = Jwt.withTokenValue("t")
                .header("alg", "HS256")
                .subject(subject)
                .issuedAt(Instant.now())
                .expiresAt(Instant.now().plusSeconds(60))
                .build();
        // The two-argument constructor marks the token authenticated; the
        // single-argument one does not, and an unauthenticated principal is
        // (correctly) nobody to the guard.
        SecurityContextHolder.getContext().setAuthentication(new JwtAuthenticationToken(jwt, List.of()));
    }
}
