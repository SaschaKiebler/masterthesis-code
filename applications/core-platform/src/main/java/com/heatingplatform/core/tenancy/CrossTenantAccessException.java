package com.heatingplatform.core.tenancy;

import java.util.UUID;

/**
 * Thrown by {@link TenantBodyGuard} when a request names, outside the URL, a
 * resource of a tenant the caller does not belong to. Mapped to 403 by the
 * global handler, which is the status the {@code AccessAuditFilter} records as
 * DENIED, so a body-carried attempt lands in the same trail as a URL-carried one.
 */
public class CrossTenantAccessException extends RuntimeException {

    private final ResourceKind kind;
    private final UUID resourceId;
    private final UUID tenantId;

    public CrossTenantAccessException(ResourceKind kind, UUID resourceId, UUID tenantId) {
        super("Access denied to another tenant's resource");
        this.kind = kind;
        this.resourceId = resourceId;
        this.tenantId = tenantId;
    }

    public ResourceKind kind() {
        return kind;
    }

    public UUID resourceId() {
        return resourceId;
    }

    public UUID tenantId() {
        return tenantId;
    }
}
