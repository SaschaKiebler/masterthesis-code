package com.heatingplatform.core.tenancy;

import java.util.Set;
import java.util.UUID;

/**
 * Which tenants one caller may see, as a value rather than a sentinel.
 *
 * <p>{@code unlimited} exists because the older
 * {@code AuthService.getAccessibleTenantIds()} returns an empty list for two
 * opposite meanings — a system admin who may see everything, and an unknown
 * subject who may see nothing. Callers that forget the distinction fail open.
 * Here the two cases differ in a boolean, and {@link #covers(UUID)} is the only
 * way to ask the question, so the trap cannot be re-entered.
 *
 * @param userId       resolved platform user, null when the subject has none
 * @param tenants      tenants the user belongs to; empty for a system admin,
 *                     whose access does not come from memberships
 * @param unlimited    true for system admins
 * @param readAtMillis when this snapshot was taken, for TTL expiry
 */
public record Membership(UUID userId, Set<UUID> tenants, boolean unlimited, long readAtMillis) {

    /** A subject with no platform user: belongs nowhere, sees nothing. */
    public static Membership none(long readAtMillis) {
        return new Membership(null, Set.of(), false, readAtMillis);
    }

    public boolean covers(UUID tenantId) {
        return unlimited || (tenantId != null && tenants.contains(tenantId));
    }

    boolean isFresh(long nowMillis, long ttlMillis) {
        return nowMillis - readAtMillis < ttlMillis;
    }
}
