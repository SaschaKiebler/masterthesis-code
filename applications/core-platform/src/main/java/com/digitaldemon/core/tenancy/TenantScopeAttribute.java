package com.digitaldemon.core.tenancy;

import java.util.UUID;

/**
 * What the interceptor hands to the audit filter through the request.
 *
 * <p>The two live in different layers — the filter runs in the security chain,
 * the interceptor inside the dispatcher — so a request attribute is the only
 * channel between them that does not need a thread-local.
 *
 * @param effectiveTenant the tenant that explains the outcome: the one that
 *                        failed the check, or else the first resolved one
 * @param denied          whether the interceptor refused the request
 */
public record TenantScopeAttribute(UUID effectiveTenant, boolean denied) {

    /** Request attribute key; the filter reads it after the chain has run. */
    public static final String KEY = "com.digitaldemon.core.tenancy.scope";
}
