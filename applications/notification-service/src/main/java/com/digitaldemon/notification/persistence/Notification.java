package com.digitaldemon.notification.persistence;

import java.time.Instant;
import java.util.UUID;

/**
 * One persisted Meldung: the actionable record created from a detection
 * event by a matching notification rule (summary = Fehlerbild from the
 * detector, detail = detector payload as Handlungskontext).
 */
public record Notification(
        UUID id,
        UUID tenantId,
        UUID ruleId,
        String type,
        String severity,
        String deviceId,
        int metricId,
        UUID assetRef,
        String summary,
        String detail,
        Instant detectedAt,
        Instant createdAt,
        Instant acknowledgedAt,
        String acknowledgedBy) {
}
