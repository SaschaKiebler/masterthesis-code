package com.digitaldemon.core.tenancy;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

/**
 * The interceptor's policy, applied to the ids the interceptor cannot see.
 *
 * <p>{@link TenantScopeInterceptor} resolves every id in the URL to its owning
 * tenant and refuses foreign ones. It deliberately does not read request
 * bodies, so an endpoint that takes {@code siteId}, {@code sourceId},
 * {@code metricPointId} or {@code tenantId} as a JSON field had, until this
 * class existed, no tenant check at all on that field. Twelve such endpoints
 * were found by the QS-SEC-01 review of 2026-09-02, and every one of them
 * turned a legitimately owned resource into a read or write on another
 * tenant's data.
 *
 * <p>Rather than twelve hand-written checks, the handlers call this guard
 * with the kind and id they are about to act on. The guard reuses the
 * interceptor's lookup, membership and decision table verbatim, so the answer
 * for a body id is by construction the same as for the same id in a URL, and
 * the kill switch {@code tenant.enforcement.mode} governs both.
 *
 * <p>A denial is thrown, not returned, and it is thrown <em>before</em> the
 * handler's own try/catch, so it reaches the global handler as a 403 rather
 * than being swallowed into a 500. The guard also leaves the audit filter the
 * tenant that explains the refusal, exactly as the interceptor does.
 */
@Slf4j
@Service
public class TenantBodyGuard {

    /**
     * Tenants that own a device id, through either extension table. A device
     * id is a string from the MQTT world, not a row in {@code objects}, so it
     * has no entry in {@link ResourceKind}; this is the one lookup that goes by
     * natural key. Only bound parameters carry request input.
     */
    static final String DEVICE_OWNERS_SQL =
            "SELECT DISTINCT o.tenant_id FROM metric_points mp "
                    + "JOIN objects o ON o.id = mp.id "
                    + "WHERE mp.device_id = ?1 AND o.tenant_id IS NOT NULL "
                    + "UNION "
                    + "SELECT DISTINCT o.tenant_id FROM physical_devices pd "
                    + "JOIN objects o ON o.id = pd.id "
                    + "WHERE pd.device_id = ?1 AND o.tenant_id IS NOT NULL";

    private final TenantOwnershipLookup ownershipLookup;
    private final TenantMembershipService membershipService;
    private final TenantAccessEvaluator evaluator;
    private final TenantEnforcementProperties properties;

    @PersistenceContext
    private EntityManager entityManager;

    public TenantBodyGuard(TenantOwnershipLookup ownershipLookup,
                           TenantMembershipService membershipService,
                           TenantAccessEvaluator evaluator,
                           TenantEnforcementProperties properties) {
        this.ownershipLookup = ownershipLookup;
        this.membershipService = membershipService;
        this.evaluator = evaluator;
        this.properties = properties;
    }

    /**
     * The caller may write to this resource, or a 403 is on its way. Decided
     * with the request's own method, so shared reference data (a global
     * object) stays off limits for a write exactly as it is in the URL case.
     */
    public void requireAccess(ResourceKind kind, UUID resourceId) {
        requireAll(kind, resourceId == null ? List.of() : List.of(resourceId), null);
    }

    /** Every id in the collection passes {@link #requireAccess}. */
    public void requireAccessToAll(ResourceKind kind, Collection<UUID> resourceIds) {
        requireAll(kind, resourceIds, null);
    }

    /**
     * The caller may refer to this resource. A reference is a read of it, so
     * the check runs with GET semantics: a foreign resource is refused, a
     * global one (a physical quantity, a system template) may be pointed at.
     * Use for link targets, formula variables and rule bindings, where the
     * thing being written is owned by the caller and merely points elsewhere.
     */
    public void requireReference(ResourceKind kind, UUID resourceId) {
        requireAll(kind, resourceId == null ? List.of() : List.of(resourceId), "GET");
    }

    /** Every id in the collection passes {@link #requireReference}. */
    public void requireReferenceToAll(ResourceKind kind, Collection<UUID> resourceIds) {
        requireAll(kind, resourceIds, "GET");
    }

    /** A tenant named in the body: the caller must belong to it. */
    public void requireTenant(UUID tenantId) {
        requireAccess(ResourceKind.TENANT, tenantId);
    }

    /**
     * A tenant named in the body, where null means "system-wide". Belonging to
     * the tenant suffices for the former; the latter is a write to shared data
     * and needs a system admin, which is the evaluator's GLOBAL rule.
     */
    public void requireTenantOrSystem(UUID tenantId) {
        if (tenantId != null) {
            requireTenant(tenantId);
            return;
        }
        if (properties.isOff()) {
            return;
        }
        Membership membership = currentMembership();
        if (membership == null || membership.unlimited()) {
            return;
        }
        check(membership, TenantScope.global(ResourceKind.TENANT, null), null);
    }

    private void requireAll(ResourceKind kind, Collection<UUID> resourceIds, String methodOverride) {
        if (resourceIds == null || resourceIds.isEmpty() || properties.isOff()) {
            return;
        }
        Membership membership = currentMembership();
        if (membership == null || membership.unlimited()) {
            return;
        }
        for (UUID resourceId : resourceIds) {
            if (resourceId != null) {
                check(membership, ownershipLookup.resolve(kind, resourceId), methodOverride);
            }
        }
    }

    /**
     * A device id the caller wants to bind to must not already belong to
     * another tenant. Without this, registering a metric point on a foreign
     * device id reads that device's live values through the caller's own
     * project, because the measurement store knows devices, not tenants.
     */
    @Transactional(readOnly = true)
    public void requireDeviceNotForeign(String deviceId) {
        if (deviceId == null || deviceId.isBlank() || properties.isOff()) {
            return;
        }
        Membership membership = currentMembership();
        if (membership == null || membership.unlimited()) {
            return;
        }
        List<?> owners = entityManager.createNativeQuery(DEVICE_OWNERS_SQL)
                .setParameter(1, deviceId.trim())
                .getResultList();
        for (Object owner : owners) {
            UUID tenantId = owner instanceof UUID uuid ? uuid : UUID.fromString(owner.toString());
            if (!membership.covers(tenantId)) {
                refuse(TenantScope.resolved(ResourceKind.OBJECT, null, tenantId), deviceId);
            }
        }
    }

    private void check(Membership membership, TenantScope scope, String methodOverride) {
        String method = methodOverride != null ? methodOverride : currentMethod();
        if (evaluator.decide(membership, scope, method) == TenantAccessEvaluator.Decision.DENY) {
            refuse(scope, String.valueOf(scope.resourceId()));
        }
    }

    private void refuse(TenantScope scope, String what) {
        markScope(scope.tenantId());
        if (!properties.isEnforcing()) {
            log.info("OBSERVE: would deny body-carried {} {} (belongs to tenant {})",
                    scope.kind(), what, scope.tenantId());
            return;
        }
        log.info("Denied cross-tenant access via request body: {} {} belongs to tenant {}",
                scope.kind(), what, scope.tenantId());
        throw new CrossTenantAccessException(scope.kind(), scope.resourceId(), scope.tenantId());
    }

    /** Same channel to the audit filter the interceptor uses. */
    private void markScope(UUID tenantId) {
        HttpServletRequest request = currentRequest();
        if (request != null) {
            request.setAttribute(TenantScopeAttribute.KEY, new TenantScopeAttribute(tenantId, true));
        }
    }

    private Membership currentMembership() {
        String subject = currentSubject();
        return subject == null ? null : membershipService.forSubject(subject);
    }

    /**
     * Writes are decided as writes. Outside a request (a scheduled job calling
     * a service that calls the guard) there is no method, and the stricter
     * reading is the safe default.
     */
    private String currentMethod() {
        HttpServletRequest request = currentRequest();
        return request == null ? "POST" : request.getMethod();
    }

    private HttpServletRequest currentRequest() {
        RequestAttributes attributes = RequestContextHolder.getRequestAttributes();
        return attributes instanceof ServletRequestAttributes servlet ? servlet.getRequest() : null;
    }

    private String currentSubject() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()) {
            return null;
        }
        return authentication.getPrincipal() instanceof Jwt jwt ? jwt.getSubject() : null;
    }
}
