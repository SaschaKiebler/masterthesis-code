package com.digitaldemon.core.tenancy;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.HandlerMapping;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Central tenant authorisation for the REST API.
 *
 * <p>This is the one place that answers "which tenant does this request
 * address". Before it existed the answer was scattered across per-controller
 * checks that were mostly absent — a probe of 106 cross-tenant attempts found
 * 41 that returned foreign data, and the audit trail saw only 29 of the 106,
 * because it could recognise a tenant only when the URL named one directly.
 *
 * <p>An interceptor rather than a filter, because only here have the path
 * variables been extracted: a servlet filter runs before handler mapping and
 * would have to re-implement route matching. An interceptor rather than
 * per-handler annotations, because opt-in is the failure mode being fixed —
 * here every route is covered by default and the build fails for any handler
 * that is neither resolvable nor explicitly {@link TenantUnscoped}.
 *
 * <p>What it does not see: ids carried in a request body, and the gRPC and
 * Kafka entry points. Those are guarded explicitly or documented as
 * trusted-internal rather than silently counted as covered.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class TenantScopeInterceptor implements HandlerInterceptor {

    private final TenantResolverRegistry registry;
    private final TenantOwnershipLookup ownershipLookup;
    private final TenantMembershipService membershipService;
    private final TenantAccessEvaluator evaluator;
    private final TenantEnforcementProperties properties;

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler)
            throws IOException {

        if (properties.isOff() || isUnscoped(handler)) {
            return true;
        }

        // Authorisation, not authentication. A request the filter chain admitted
        // without a principal (the dev profile permits everything) is none of
        // this interceptor's business; in the secured chain /api/v1/** is
        // authenticated, so this branch cannot be reached there.
        String subject = currentSubject();
        if (subject == null) {
            return true;
        }

        List<TenantScope> scopes = scopesOf(request);
        if (scopes.isEmpty()) {
            return true;
        }

        Membership membership = membershipService.forSubject(subject);
        if (membership.unlimited()) {
            return true;
        }

        String method = request.getMethod();
        TenantScope firstResolved = null;
        for (TenantScope scope : scopes) {
            if (firstResolved == null && scope.resolution() == TenantScope.Resolution.RESOLVED) {
                firstResolved = scope;
            }
            if (evaluator.decide(membership, scope, method) == TenantAccessEvaluator.Decision.DENY) {
                return deny(request, response, subject, scope);
            }
        }

        // Allowed: still hand the audit filter the tenant this request touched.
        markScope(request, firstResolved == null ? null : firstResolved.tenantId(), false);
        return true;
    }

    /**
     * Refuse, and leave the audit filter everything it needs.
     *
     * <p>The attribute is set BEFORE the status is written, so a denied request
     * carries the tenant that explains the denial. The interceptor deliberately
     * does not write the audit row itself — the filter is the single writer,
     * otherwise QS-SEC-01's "exactly one entry per attempt" would double-count.
     */
    private boolean deny(HttpServletRequest request, HttpServletResponse response,
                         String subject, TenantScope scope) throws IOException {
        markScope(request, scope.tenantId(), true);

        if (!properties.isEnforcing()) {
            log.info("OBSERVE: would deny {} {} for subject {} ({} {} belongs to tenant {})",
                    request.getMethod(), request.getRequestURI(), subject,
                    scope.kind(), scope.resourceId(), scope.tenantId());
            return true;
        }

        log.info("Denied cross-tenant access: {} {} for subject {} ({} {} belongs to tenant {})",
                request.getMethod(), request.getRequestURI(), subject,
                scope.kind(), scope.resourceId(), scope.tenantId());

        // Written directly rather than thrown: the status the audit filter reads
        // must not depend on exception-resolver ordering.
        response.setStatus(HttpStatus.FORBIDDEN.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.getWriter().write("{\"message\":\"Access denied to another tenant's resource\"}");
        return false;
    }

    private void markScope(HttpServletRequest request, UUID tenantId, boolean denied) {
        request.setAttribute(TenantScopeAttribute.KEY, new TenantScopeAttribute(tenantId, denied));
    }

    /** Every tenant-scoped resource this request addresses, resolved to its owner. */
    private List<TenantScope> scopesOf(HttpServletRequest request) {
        List<TenantScope> scopes = new ArrayList<>();

        @SuppressWarnings("unchecked")
        Map<String, String> pathVariables = (Map<String, String>)
                request.getAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE);

        for (TenantResolverRegistry.AddressedResource resource
                : registry.resourcesIn(request.getRequestURI(), pathVariables)) {
            scopes.add(ownershipLookup.resolve(resource.kind(), resource.resourceId()));
        }

        // A tenant named in the query string counts too (GET /sites?tenantId=…).
        UUID queryTenant = registry.tenantFromQueryString(request.getQueryString());
        if (queryTenant != null) {
            scopes.add(TenantScope.resolved(ResourceKind.TENANT, queryTenant, queryTenant));
        }
        return scopes;
    }

    private boolean isUnscoped(Object handler) {
        if (!(handler instanceof HandlerMethod method)) {
            // Static resources, error dispatch: nothing to scope.
            return true;
        }
        return method.getMethodAnnotation(TenantUnscoped.class) != null
                || method.getBeanType().getAnnotation(TenantUnscoped.class) != null;
    }

    private String currentSubject() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()) {
            return null;
        }
        if (authentication.getPrincipal() instanceof Jwt jwt) {
            return jwt.getSubject();
        }
        return null;
    }
}
