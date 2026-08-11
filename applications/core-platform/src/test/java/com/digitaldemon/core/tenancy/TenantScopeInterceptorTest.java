package com.digitaldemon.core.tenancy;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerMapping;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.verifyNoInteractions;

/**
 * The interceptor's contract: refuse foreign resources, leave the audit filter
 * a resolved tenant either way, and never get in the way of requests it has no
 * business deciding.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class TenantScopeInterceptorTest {

    private static final UUID OWN_TENANT = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID FOREIGN_TENANT = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID USER_ID = UUID.fromString("33333333-3333-3333-3333-333333333333");
    private static final UUID PROJECT_ID = UUID.fromString("44444444-4444-4444-4444-444444444444");
    private static final String SUBJECT = "local|erika";

    @Mock
    private TenantOwnershipLookup ownershipLookup;
    @Mock
    private TenantMembershipService membershipService;

    private TenantEnforcementProperties properties;
    private TenantScopeInterceptor interceptor;

    /** Stands in for a real controller so HandlerMethod resolution works. */
    static class StubController {
        public void open() {
        }

        @TenantUnscoped(reason = "test fixture")
        public void unscoped() {
        }
    }

    @BeforeEach
    void setUp() throws Exception {
        properties = new TenantEnforcementProperties();
        properties.setMode(TenantEnforcementProperties.Mode.ENFORCE);

        interceptor = new TenantScopeInterceptor(
                new TenantResolverRegistry(), ownershipLookup, membershipService,
                new TenantAccessEvaluator(null), properties);

        given(membershipService.forSubject(SUBJECT))
                .willReturn(new Membership(USER_ID, Set.of(OWN_TENANT), false, 0L));
        authenticateAs(SUBJECT);
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    private void authenticateAs(String subject) {
        Jwt jwt = new Jwt("token", Instant.now(), Instant.now().plusSeconds(3600),
                Map.of("alg", "none"), Map.of("sub", subject));
        SecurityContextHolder.getContext().setAuthentication(new JwtAuthenticationToken(jwt, List.of()));
    }

    private HandlerMethod handler(String methodName) throws Exception {
        return new HandlerMethod(new StubController(),
                StubController.class.getMethod(methodName));
    }

    private MockHttpServletRequest projectRequest(String method) {
        MockHttpServletRequest request = new MockHttpServletRequest(method, "/api/v1/projects/" + PROJECT_ID);
        request.setAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE,
                Map.of("id", PROJECT_ID.toString()));
        return request;
    }

    private TenantScopeAttribute scopeOf(MockHttpServletRequest request) {
        return (TenantScopeAttribute) request.getAttribute(TenantScopeAttribute.KEY);
    }

    @Test
    void a_foreign_resource_is_refused_with_403_and_marked_for_the_audit_trail() throws Exception {
        given(ownershipLookup.resolve(ResourceKind.PROJECT, PROJECT_ID))
                .willReturn(TenantScope.resolved(ResourceKind.PROJECT, PROJECT_ID, FOREIGN_TENANT));

        MockHttpServletRequest request = projectRequest("GET");
        MockHttpServletResponse response = new MockHttpServletResponse();

        boolean proceed = interceptor.preHandle(request, response, handler("open"));

        assertThat(proceed).isFalse();
        assertThat(response.getStatus()).isEqualTo(403);
        assertThat(scopeOf(request).denied()).isTrue();
        assertThat(scopeOf(request).effectiveTenant()).isEqualTo(FOREIGN_TENANT);
    }

    @Test
    void the_callers_own_resource_passes_and_still_marks_the_tenant() throws Exception {
        given(ownershipLookup.resolve(ResourceKind.PROJECT, PROJECT_ID))
                .willReturn(TenantScope.resolved(ResourceKind.PROJECT, PROJECT_ID, OWN_TENANT));

        MockHttpServletRequest request = projectRequest("GET");
        MockHttpServletResponse response = new MockHttpServletResponse();

        assertThat(interceptor.preHandle(request, response, handler("open"))).isTrue();
        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(scopeOf(request).denied()).isFalse();
        assertThat(scopeOf(request).effectiveTenant()).isEqualTo(OWN_TENANT);
    }

    /** OBSERVE must record the same verdict but let the request through. */
    @Test
    void observe_mode_marks_the_denial_without_blocking() throws Exception {
        properties.setMode(TenantEnforcementProperties.Mode.OBSERVE);
        given(ownershipLookup.resolve(ResourceKind.PROJECT, PROJECT_ID))
                .willReturn(TenantScope.resolved(ResourceKind.PROJECT, PROJECT_ID, FOREIGN_TENANT));

        MockHttpServletRequest request = projectRequest("GET");
        MockHttpServletResponse response = new MockHttpServletResponse();

        assertThat(interceptor.preHandle(request, response, handler("open"))).isTrue();
        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(scopeOf(request).effectiveTenant()).isEqualTo(FOREIGN_TENANT);
        assertThat(scopeOf(request).denied()).isTrue();
    }

    @Test
    void off_mode_does_nothing_at_all() throws Exception {
        properties.setMode(TenantEnforcementProperties.Mode.OFF);

        MockHttpServletRequest request = projectRequest("GET");
        assertThat(interceptor.preHandle(request, new MockHttpServletResponse(), handler("open"))).isTrue();

        assertThat(scopeOf(request)).isNull();
        verifyNoInteractions(ownershipLookup, membershipService);
    }

    /** A system admin must not cost a resolution. */
    @Test
    void a_system_admin_passes_without_any_lookup() throws Exception {
        given(membershipService.forSubject(SUBJECT))
                .willReturn(new Membership(USER_ID, Set.of(), true, 0L));

        MockHttpServletRequest request = projectRequest("DELETE");
        assertThat(interceptor.preHandle(request, new MockHttpServletResponse(), handler("open"))).isTrue();
    }

    /**
     * Authorisation, not authentication: a request the filter chain admitted
     * without a principal is not this interceptor's business. Without this the
     * dev profile, which sends no token at all, would break entirely.
     */
    @Test
    void a_request_without_a_subject_is_left_alone() throws Exception {
        SecurityContextHolder.clearContext();

        MockHttpServletRequest request = projectRequest("GET");
        assertThat(interceptor.preHandle(request, new MockHttpServletResponse(), handler("open"))).isTrue();
        verifyNoInteractions(ownershipLookup, membershipService);
    }

    @Test
    void an_explicitly_unscoped_handler_is_skipped() throws Exception {
        MockHttpServletRequest request = projectRequest("GET");
        assertThat(interceptor.preHandle(request, new MockHttpServletResponse(), handler("unscoped"))).isTrue();
        verifyNoInteractions(ownershipLookup, membershipService);
    }

    @Test
    void a_route_without_path_variables_is_skipped() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/projects");
        assertThat(interceptor.preHandle(request, new MockHttpServletResponse(), handler("open"))).isTrue();
        verifyNoInteractions(ownershipLookup);
    }

    /** An unknown id must reach the handler, so a genuine 404 stays a 404. */
    @Test
    void an_unknown_resource_is_left_to_the_handler() throws Exception {
        given(ownershipLookup.resolve(any(), any()))
                .willReturn(TenantScope.unknown(ResourceKind.PROJECT, PROJECT_ID));

        MockHttpServletRequest request = projectRequest("GET");
        MockHttpServletResponse response = new MockHttpServletResponse();

        assertThat(interceptor.preHandle(request, response, handler("open"))).isTrue();
        assertThat(response.getStatus()).isEqualTo(200);
    }

    /** A foreign tenant named in the query string is caught too. */
    @Test
    void a_foreign_tenant_in_the_query_string_is_refused() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/sites");
        request.setQueryString("page=1&tenantId=" + FOREIGN_TENANT);
        MockHttpServletResponse response = new MockHttpServletResponse();

        assertThat(interceptor.preHandle(request, response, handler("open"))).isFalse();
        assertThat(response.getStatus()).isEqualTo(403);
    }
}
