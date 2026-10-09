package com.heatingplatform.core.tenancy;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Marks a handler whose path variables are deliberately not tenant-scoped.
 *
 * <p>The {@code reason} is mandatory and is the point of the annotation: it
 * turns "nobody thought about this endpoint" into "somebody decided, and here
 * is why". {@code TenantScopeCoverageTest} fails the build for any handler
 * with an unclassified path variable, so the decision cannot be skipped.
 */
@Target({ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
public @interface TenantUnscoped {

    /** Why this handler needs no tenant check. Must not be blank. */
    String reason();
}
