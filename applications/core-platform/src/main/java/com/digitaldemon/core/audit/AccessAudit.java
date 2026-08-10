package com.digitaldemon.core.audit;

import jakarta.persistence.*;
import lombok.Data;

import java.time.Instant;
import java.util.UUID;

/**
 * One recorded cross-tenant access attempt (UC-BET-05).
 *
 * Written by {@link AccessAuditFilter} for attempts that were not satisfied for
 * the caller's own tenant. Same-tenant traffic is not recorded, see
 * {@code V30__access_audit.sql} for the reasoning.
 */
@Entity
@Table(name = "access_audit")
@Data
public class AccessAudit {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "occurred_at", nullable = false)
    private Instant occurredAt = Instant.now();

    /** JWT subject of the caller; always present for authenticated requests. */
    @Column(name = "subject")
    private String subject;

    /** Resolved platform user, null when the subject has no user record yet. */
    @Column(name = "user_id")
    private UUID userId;

    /** Tenant the request named, null when it named none. */
    @Column(name = "requested_tenant")
    private UUID requestedTenant;

    @Column(nullable = false)
    private String method;

    @Column(nullable = false)
    private String path;

    @Column(name = "http_status", nullable = false)
    private int httpStatus;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private AccessOutcome outcome;
}
