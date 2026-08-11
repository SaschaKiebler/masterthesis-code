package com.digitaldemon.core.tenancy;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.persistence.Query;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Resolves a resource id to its owning tenant, with a cache.
 *
 * <p>The long TTL is defensible because the mapping is immutable in practice:
 * every {@code setTenant} call site in the codebase runs at creation time, and
 * nothing moves a resource between tenants. A stale entry can therefore only
 * outlive a deletion, and an entry for a deleted row yields a 403 or a 404 —
 * never an unauthorised 200. That asymmetry is what makes caching an
 * authorisation input acceptable here, and it is worth stating rather than
 * assuming.
 */
@Slf4j
@Service
public class TenantOwnershipLookup {

    /** Bounded staleness of a resource-to-tenant mapping. */
    static final long OWNERSHIP_TTL_MILLIS = 300_000;

    /** Guards against unbounded growth on a hostile id stream. */
    static final int MAX_ENTRIES = 20_000;

    @PersistenceContext
    private EntityManager entityManager;

    private final Clock clock;
    private final ConcurrentHashMap<CacheKey, CachedScope> cache = new ConcurrentHashMap<>();

    public TenantOwnershipLookup(Clock clock) {
        this.clock = clock;
    }

    private record CacheKey(ResourceKind kind, UUID resourceId) {
    }

    private record CachedScope(TenantScope scope, long readAtMillis) {
        boolean isFresh(long nowMillis) {
            return nowMillis - readAtMillis < OWNERSHIP_TTL_MILLIS;
        }
    }

    @Transactional(readOnly = true)
    public TenantScope resolve(ResourceKind kind, UUID resourceId) {
        // The tenant path variable needs no lookup at all: it IS the tenant.
        if (!kind.needsLookup()) {
            return TenantScope.resolved(kind, resourceId, resourceId);
        }

        long now = clock.millis();
        CacheKey key = new CacheKey(kind, resourceId);

        CachedScope cached = cache.get(key);
        if (cached != null && cached.isFresh(now)) {
            return cached.scope();
        }

        TenantScope scope = query(kind, resourceId);
        if (cache.size() < MAX_ENTRIES) {
            cache.put(key, new CachedScope(scope, now));
        }
        return scope;
    }

    private TenantScope query(ResourceKind kind, UUID resourceId) {
        try {
            Query query = entityManager.createNativeQuery(kind.tenantQuery());
            query.setParameter(1, resourceId);
            List<?> rows = query.getResultList();

            if (rows.isEmpty()) {
                return TenantScope.unknown(kind, resourceId);
            }
            Object tenant = rows.get(0);
            if (tenant == null) {
                return TenantScope.global(kind, resourceId);
            }
            return TenantScope.resolved(kind, resourceId, toUuid(tenant));
        } catch (RuntimeException e) {
            // A broken lookup must not become an open door: treat it as unknown
            // so the handler decides, and make the failure loud in the log.
            log.warn("Tenant lookup failed for {} {}: {}", kind, resourceId, e.toString());
            return TenantScope.unknown(kind, resourceId);
        }
    }

    private UUID toUuid(Object value) {
        return value instanceof UUID uuid ? uuid : UUID.fromString(value.toString());
    }

    /** Visible for the coverage test, which executes every statement once. */
    Map<ResourceKind, String> statements() {
        Map<ResourceKind, String> statements = new java.util.EnumMap<>(ResourceKind.class);
        for (ResourceKind kind : ResourceKind.values()) {
            if (kind.needsLookup()) {
                statements.put(kind, kind.tenantQuery());
            }
        }
        return statements;
    }
}
