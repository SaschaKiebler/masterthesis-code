package com.heatingplatform.core.audit;

import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.doAnswer;

/**
 * Covers what the audit filter records and, just as importantly, what it does
 * not: same-tenant traffic must leave no trace, or the trail would grow with
 * every request and colour the QS-PER-03 response times.
 */
class AccessAuditFilterTest {

    private static final UUID OWN_TENANT = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID FOREIGN_TENANT = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final String SUBJECT = "user-a";

    private AccessAuditService service;
    private AccessAuditFilter filter;
    private List<RecordedEntry> recorded;

    private record RecordedEntry(String subject, UUID tenant, String method, String path,
                                 int status, AccessOutcome outcome) {
    }

    @BeforeEach
    void setUp() {
        service = mock(AccessAuditService.class);
        recorded = new ArrayList<>();

        // Mirrors the real contract: no tenant named means nothing to judge.
        when(service.isCrossTenant(anyString(), any())).thenAnswer(call -> {
            UUID tenant = call.getArgument(1);
            return tenant != null && !OWN_TENANT.equals(tenant);
        });

        doAnswer(call -> {
            recorded.add(new RecordedEntry(
                    call.getArgument(0), call.getArgument(1), call.getArgument(2),
                    call.getArgument(3), call.getArgument(4), call.getArgument(5)));
            return null;
        }).when(service).record(any(), any(), anyString(), anyString(), anyInt(), any());

        filter = new AccessAuditFilter(service);
        ReflectionTestUtils.setField(filter, "enabled", true);
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

    /** Runs the filter over one request and returns what was recorded. */
    private List<RecordedEntry> run(String method, String uri, String queryString, int status)
            throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest(method, uri);
        request.setQueryString(queryString);
        MockHttpServletResponse response = new MockHttpServletResponse();

        FilterChain chain = (req, res) -> ((MockHttpServletResponse) res).setStatus(status);
        filter.doFilter(request, response, chain);
        return recorded;
    }

    @Test
    void records_a_refused_request_as_denied() throws Exception {
        run("GET", "/api/v1/projects", "tenantId=" + FOREIGN_TENANT, 403);

        assertThat(recorded).singleElement().satisfies(entry -> {
            assertThat(entry.outcome()).isEqualTo(AccessOutcome.DENIED);
            assertThat(entry.tenant()).isEqualTo(FOREIGN_TENANT);
            assertThat(entry.subject()).isEqualTo(SUBJECT);
            assertThat(entry.status()).isEqualTo(403);
        });
    }

    /**
     * The case the trail exists for: the endpoint narrowed its query instead of
     * refusing, so the caller sees a harmless 200 and nothing else would show
     * that a foreign tenant was asked for.
     */
    @Test
    void records_a_silently_filtered_request() throws Exception {
        run("GET", "/api/v1/projects", "tenantId=" + FOREIGN_TENANT, 200);

        assertThat(recorded).singleElement().satisfies(entry -> {
            assertThat(entry.outcome()).isEqualTo(AccessOutcome.FILTERED);
            assertThat(entry.tenant()).isEqualTo(FOREIGN_TENANT);
        });
    }

    @Test
    void records_a_missing_credential_as_unauthenticated() throws Exception {
        SecurityContextHolder.clearContext();
        run("GET", "/api/v1/projects", null, 401);

        assertThat(recorded).singleElement()
                .satisfies(entry -> assertThat(entry.outcome()).isEqualTo(AccessOutcome.UNAUTHENTICATED));
    }

    @Test
    void leaves_no_trace_for_a_request_to_the_callers_own_tenant() throws Exception {
        run("GET", "/api/v1/projects", "tenantId=" + OWN_TENANT, 200);
        assertThat(recorded).isEmpty();
    }

    @Test
    void leaves_no_trace_for_a_successful_request_naming_no_tenant() throws Exception {
        run("GET", "/api/v1/projects", null, 200);
        assertThat(recorded).isEmpty();
    }

    @Test
    void reads_the_tenant_from_the_path_when_the_query_string_has_none() throws Exception {
        run("GET", "/api/v1/tenants/" + FOREIGN_TENANT + "/members", null, 403);

        assertThat(recorded).singleElement()
                .satisfies(entry -> assertThat(entry.tenant()).isEqualTo(FOREIGN_TENANT));
    }

    @Test
    void ignores_a_tenant_parameter_that_is_not_a_uuid() throws Exception {
        run("GET", "/api/v1/projects", "tenantId=not-a-uuid", 200);
        assertThat(recorded).isEmpty();
    }

    @Test
    void finds_the_tenant_parameter_among_others() throws Exception {
        run("GET", "/api/v1/projects", "limit=50&tenantId=" + FOREIGN_TENANT + "&sort=name", 200);

        assertThat(recorded).singleElement()
                .satisfies(entry -> assertThat(entry.tenant()).isEqualTo(FOREIGN_TENANT));
    }

    /** Non-API traffic such as actuator probes must not reach the trail at all. */
    @Test
    void skips_requests_outside_the_api() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/actuator/health");
        MockHttpServletResponse response = new MockHttpServletResponse();
        filter.doFilter(request, response, (req, res) -> ((MockHttpServletResponse) res).setStatus(200));

        verifyNoInteractions(service);
    }

    @Test
    void skips_everything_when_auditing_is_switched_off() throws Exception {
        ReflectionTestUtils.setField(filter, "enabled", false);
        run("GET", "/api/v1/projects", "tenantId=" + FOREIGN_TENANT, 403);

        verifyNoInteractions(service);
    }

    /** A broken trail must never break the API it observes. */
    @Test
    void a_failing_recorder_does_not_fail_the_request() throws Exception {
        doAnswer(call -> {
            throw new IllegalStateException("audit store unavailable");
        }).when(service).record(any(), any(), anyString(), anyString(), anyInt(), any());

        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/projects");
        request.setQueryString("tenantId=" + FOREIGN_TENANT);
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, (req, res) -> ((MockHttpServletResponse) res).setStatus(403));

        assertThat(response.getStatus()).isEqualTo(403);
    }
}
