package com.digitaldemon.notification.auth;

import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.UUID;

/**
 * Resolves the caller's tenant from the JWT subject via the shared
 * master-data tables (users, user_tenant_roles) — read-only access, the
 * same cross-context read device-management performs. Mirrors core's
 * AuthService semantics: SYSTEM_ADMIN reaches every tenant (optional
 * tenantId query parameter selects one), everyone else is restricted to
 * their memberships with the first accessible tenant as default.
 */
@Component
@RequiredArgsConstructor
public class TenantResolver {

    private final JdbcClient jdbc;

    /** Resolve the effective tenant for the current request. */
    public UUID resolveTenant(UUID requestedTenantId) {
        String subject = currentSubject();
        record UserRow(UUID id, String globalRole) {
        }
        UserRow user = jdbc.sql(
                        "SELECT id, global_role FROM users WHERE subject = :subject")
                .param("subject", subject)
                .query((rs, i) -> new UserRow(
                        rs.getObject("id", UUID.class), rs.getString("global_role")))
                .optional()
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.FORBIDDEN, "Unknown user"));

        UUID userId = user.id();
        // global_role is stored lowercase (core parses it case-insensitively)
        boolean systemAdmin = "SYSTEM_ADMIN".equalsIgnoreCase(user.globalRole());

        if (systemAdmin) {
            if (requestedTenantId != null) {
                return requestedTenantId;
            }
            return jdbc.sql("SELECT id FROM tenants ORDER BY created_at LIMIT 1")
                    .query(UUID.class)
                    .optional()
                    .orElseThrow(() -> new ResponseStatusException(
                            HttpStatus.NOT_FOUND, "No tenants exist"));
        }

        List<UUID> accessible = jdbc.sql("""
                        SELECT tenant_id FROM user_tenant_roles
                        WHERE user_id = :userId ORDER BY created_at
                        """)
                .param("userId", userId)
                .query(UUID.class)
                .list();
        if (accessible.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "No tenant access");
        }
        if (requestedTenantId == null) {
            return accessible.get(0);
        }
        if (!accessible.contains(requestedTenantId)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "No access to tenant");
        }
        return requestedTenantId;
    }

    /** Subject of the authenticated caller (used for acknowledged_by). */
    public String currentSubject() {
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication instanceof JwtAuthenticationToken jwtAuth) {
            Jwt jwt = jwtAuth.getToken();
            return jwt.getSubject();
        }
        throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "No authenticated user");
    }
}
