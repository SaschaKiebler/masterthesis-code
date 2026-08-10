package com.digitaldemon.core.audit;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/**
 * Records cross-tenant access attempts against the API (UC-BET-05, QS-SEC-01).
 *
 * <p>The core enforces tenant boundaries in two different ways. Some endpoints
 * refuse an unauthorised tenant outright ({@code canAccessTenant} → 403), others
 * narrow their query to the caller's tenants and answer 2xx with the foreign
 * rows simply absent. Both keep data in, but only the first is visible to an
 * operator. This filter records both, tagged with {@link AccessOutcome}, so the
 * evaluation can tell them apart per endpoint.
 *
 * <p>Deliberate limits, to be stated in the thesis rather than glossed over:
 * <ul>
 *   <li>Only tenants named in the URL are seen. A tenant id sent in a JSON body
 *       would require buffering every request body, which would distort the
 *       QS-PER-03 measurements. Body-carried tenants are covered by the
 *       controller-level checks, not by this trail.</li>
 *   <li>Endpoints addressing a resource by its own id ({@code /projects/{id}})
 *       expose no tenant in the URL. Whether they leak across tenants is what
 *       the QS-SEC-01 probe measures on the response body; this filter cannot
 *       answer it.</li>
 * </ul>
 *
 * <p>Auditing never fails a request: any error while recording is logged and
 * swallowed.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AccessAuditFilter extends OncePerRequestFilter {

    private static final String API_PREFIX = "/api/v1/";
    private static final String TENANT_PARAM = "tenantId=";
    private static final String TENANT_PATH_SEGMENT = "/tenants/";

    private final AccessAuditService accessAuditService;

    /**
     * Lets the evaluation run the same build with and without the trail, so the
     * cost of auditing can be quantified instead of assumed.
     */
    @Value("${audit.access.enabled:true}")
    private boolean enabled;

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !enabled || !request.getRequestURI().startsWith(API_PREFIX);
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {

        // Read the caller before running the chain: Spring Security clears the
        // security context on the way out, so afterwards it would be gone.
        String subject = currentSubject();
        UUID requestedTenant = tenantFromRequest(request);

        filterChain.doFilter(request, response);

        try {
            audit(request, response.getStatus(), subject, requestedTenant);
        } catch (RuntimeException e) {
            log.warn("Access audit failed for {} {}: {}",
                    request.getMethod(), request.getRequestURI(), e.toString());
        }
    }

    private void audit(HttpServletRequest request, int status, String subject, UUID requestedTenant) {
        AccessOutcome outcome = classify(status, subject, requestedTenant);
        if (outcome == null) {
            return;
        }
        accessAuditService.record(
                subject, requestedTenant, request.getMethod(), request.getRequestURI(), status, outcome);
    }

    /** Returns the outcome worth recording, or null when there is nothing to record. */
    private AccessOutcome classify(int status, String subject, UUID requestedTenant) {
        if (status == 401) {
            return AccessOutcome.UNAUTHENTICATED;
        }
        if (status == 403) {
            return AccessOutcome.DENIED;
        }
        // A 2xx that named a tenant the caller does not belong to means the
        // endpoint filtered instead of refusing. The null check comes first so
        // requests naming no tenant never reach the membership lookup — that is
        // the bulk of the traffic under QS-PER-03.
        if (requestedTenant == null || status < 200 || status >= 300) {
            return null;
        }
        return accessAuditService.isCrossTenant(subject, requestedTenant) ? AccessOutcome.FILTERED : null;
    }

    private String currentSubject() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()) {
            return null;
        }
        if (authentication.getPrincipal() instanceof Jwt jwt) {
            return jwt.getSubject();
        }
        return authentication.getName();
    }

    /**
     * Pull a tenant id out of the URL.
     *
     * <p>The query string is parsed by hand rather than through
     * {@code getParameter}, which would consume a form-encoded body and leave
     * the controller with nothing to read.
     */
    private UUID tenantFromRequest(HttpServletRequest request) {
        UUID fromQuery = tenantFromQueryString(request.getQueryString());
        if (fromQuery != null) {
            return fromQuery;
        }
        return tenantFromPath(request.getRequestURI());
    }

    private UUID tenantFromQueryString(String queryString) {
        if (queryString == null) {
            return null;
        }
        for (String pair : queryString.split("&")) {
            if (!pair.startsWith(TENANT_PARAM)) {
                continue;
            }
            String raw = URLDecoder.decode(pair.substring(TENANT_PARAM.length()), StandardCharsets.UTF_8);
            return parseUuidOrNull(raw);
        }
        return null;
    }

    private UUID tenantFromPath(String uri) {
        int start = uri.indexOf(TENANT_PATH_SEGMENT);
        if (start < 0) {
            return null;
        }
        int from = start + TENANT_PATH_SEGMENT.length();
        int to = uri.indexOf('/', from);
        return parseUuidOrNull(to < 0 ? uri.substring(from) : uri.substring(from, to));
    }

    private UUID parseUuidOrNull(String raw) {
        try {
            return UUID.fromString(raw);
        } catch (IllegalArgumentException e) {
            // Not a tenant uuid (a name, a sub-route, a malformed value) — the
            // request simply names no tenant this filter can check.
            return null;
        }
    }
}
