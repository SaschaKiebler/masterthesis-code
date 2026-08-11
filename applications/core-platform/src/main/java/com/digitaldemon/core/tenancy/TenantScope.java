package com.digitaldemon.core.tenancy;

import java.util.UUID;

/**
 * One addressed resource and the tenant it belongs to.
 *
 * @param kind       what the id refers to
 * @param resourceId the id taken from the URL
 * @param tenantId   the owning tenant, null unless {@code resolution} is RESOLVED
 * @param resolution how the lookup ended
 */
public record TenantScope(ResourceKind kind, UUID resourceId, UUID tenantId, Resolution resolution) {

    public enum Resolution {
        /** The resource exists and belongs to a tenant. */
        RESOLVED,
        /** The resource exists but has no tenant: shared reference data. */
        GLOBAL,
        /** No such row. The handler answers, normally with 404. */
        UNKNOWN
    }

    public static TenantScope resolved(ResourceKind kind, UUID resourceId, UUID tenantId) {
        return new TenantScope(kind, resourceId, tenantId, Resolution.RESOLVED);
    }

    public static TenantScope global(ResourceKind kind, UUID resourceId) {
        return new TenantScope(kind, resourceId, null, Resolution.GLOBAL);
    }

    public static TenantScope unknown(ResourceKind kind, UUID resourceId) {
        return new TenantScope(kind, resourceId, null, Resolution.UNKNOWN);
    }
}
