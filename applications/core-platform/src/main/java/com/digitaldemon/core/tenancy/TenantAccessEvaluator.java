package com.digitaldemon.core.tenancy;

import com.digitaldemon.core.site.SiteAssignmentRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.Set;

/**
 * The tenant access policy, in one readable place.
 *
 * <p>This class is the security policy rather than an implementation of it —
 * every rule below is a row of the table documented in the thesis, and the
 * parameterised test mirrors the same rows, so policy, code and test stay one
 * artefact.
 *
 * <table>
 *   <caption>Decision table</caption>
 *   <tr><th>Membership</th><th>Resolution</th><th>Method</th><th>Decision</th></tr>
 *   <tr><td>unlimited</td><td>any</td><td>any</td><td>ALLOW</td></tr>
 *   <tr><td>member</td><td>RESOLVED</td><td>any</td><td>ALLOW</td></tr>
 *   <tr><td>not a member</td><td>RESOLVED</td><td>any</td><td>DENY, unless site-assigned</td></tr>
 *   <tr><td>any</td><td>GLOBAL</td><td>read</td><td>ALLOW</td></tr>
 *   <tr><td>any</td><td>GLOBAL</td><td>write</td><td>DENY unless unlimited</td></tr>
 *   <tr><td>any</td><td>UNKNOWN</td><td>any</td><td>ALLOW, the handler answers 404</td></tr>
 * </table>
 */
@Service
@RequiredArgsConstructor
public class TenantAccessEvaluator {

    private static final Set<String> READ_METHODS = Set.of("GET", "HEAD", "OPTIONS");

    private final SiteAssignmentRepository siteAssignmentRepository;

    public enum Decision {
        ALLOW,
        DENY
    }

    /**
     * Decide one scope.
     *
     * @param membership who is asking
     * @param scope      what they addressed
     * @param method     the HTTP method, so shared reference data stays readable
     *                   but not writable
     */
    public Decision decide(Membership membership, TenantScope scope, String method) {
        if (membership.unlimited()) {
            return Decision.ALLOW;
        }

        return switch (scope.resolution()) {
            // Shared reference data (object types, system templates, the seeded
            // physical quantities). Everyone reads it; only an admin changes it,
            // because a viewer must not edit the vocabulary all tenants share.
            case GLOBAL -> isRead(method) ? Decision.ALLOW : Decision.DENY;

            // No such row. Denying here would turn every genuine 404 into a 403
            // and hide real bugs behind an access error.
            case UNKNOWN -> Decision.ALLOW;

            case RESOLVED -> decideResolved(membership, scope);
        };
    }

    private Decision decideResolved(Membership membership, TenantScope scope) {
        if (membership.covers(scope.tenantId())) {
            return Decision.ALLOW;
        }
        // Only now, after the tenant check has already failed, consider the
        // technician case: a user assigned to an individual site keeps access to
        // it. Consulted last, so it costs nothing on the hot path and cannot
        // widen the tenant rule.
        return isAssignedToSite(membership, scope) ? Decision.ALLOW : Decision.DENY;
    }

    private boolean isAssignedToSite(Membership membership, TenantScope scope) {
        if (membership.userId() == null || scope.kind() != ResourceKind.OBJECT) {
            return false;
        }
        return siteAssignmentRepository.existsByUserIdAndSiteId(membership.userId(), scope.resourceId());
    }

    private boolean isRead(String method) {
        return method != null && READ_METHODS.contains(method.toUpperCase());
    }
}
