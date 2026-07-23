package com.digitaldemon.notification.persistence;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * One per-tenant notification rule: which detection events (filter), how
 * often at most (dedup) and where to additionally deliver (webhook). The
 * persisted Meldung itself is always created when a rule matches.
 *
 * A null id marks the implicit default rule derived from the global
 * notification.policy.* properties, applied when a tenant has no rules so
 * unconfigured tenants keep receiving Meldungen.
 */
public record NotificationRule(
        UUID id,
        UUID tenantId,
        String name,
        List<String> eventTypes,
        String minSeverity,
        int cooldownMinutes,
        String webhookUrl,
        String webhookToken,
        boolean enabled,
        Instant createdAt,
        Instant updatedAt) {
}
