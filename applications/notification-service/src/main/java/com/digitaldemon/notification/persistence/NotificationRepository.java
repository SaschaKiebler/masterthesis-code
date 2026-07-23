package com.digitaldemon.notification.persistence;

import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
@RequiredArgsConstructor
public class NotificationRepository {

    private final JdbcClient jdbc;

    public void insert(UUID tenantId, UUID ruleId, String type, String severity,
                       String deviceId, int metricId, UUID assetRef,
                       String summary, String detailJson, Instant detectedAt) {
        jdbc.sql("""
                INSERT INTO notifications
                    (tenant_id, rule_id, type, severity, device_id, metric_id,
                     asset_ref, summary, detail, detected_at)
                VALUES (:tenantId, :ruleId, :type, :severity, :deviceId, :metricId,
                        :assetRef, :summary, CAST(:detail AS jsonb), :detectedAt)
                """)
                .param("tenantId", tenantId)
                .param("ruleId", ruleId)
                .param("type", type)
                .param("severity", severity)
                .param("deviceId", deviceId)
                .param("metricId", metricId)
                .param("assetRef", assetRef)
                .param("summary", summary)
                .param("detail", detailJson == null || detailJson.isBlank() ? "{}" : detailJson)
                .param("detectedAt", Timestamp.from(detectedAt))
                .update();
    }

    public List<Notification> query(UUID tenantId, Instant since, String severity,
                                    Boolean acknowledged, int limit, int offset) {
        return jdbc.sql("""
                SELECT * FROM notifications
                WHERE tenant_id = :tenantId
                  AND (CAST(:since AS timestamptz) IS NULL OR created_at >= :since)
                  AND (:severity IS NULL OR severity = :severity)
                  AND (:acknowledged IS NULL
                       OR (:acknowledged = TRUE  AND acknowledged_at IS NOT NULL)
                       OR (:acknowledged = FALSE AND acknowledged_at IS NULL))
                ORDER BY created_at DESC
                LIMIT :limit OFFSET :offset
                """)
                .param("tenantId", tenantId)
                .param("since", since == null ? null : Timestamp.from(since))
                .param("severity", severity)
                .param("acknowledged", acknowledged)
                .param("limit", limit)
                .param("offset", offset)
                .query(NotificationRepository::mapNotification)
                .list();
    }

    public Optional<Notification> acknowledge(UUID id, UUID tenantId, String acknowledgedBy) {
        return jdbc.sql("""
                UPDATE notifications
                SET acknowledged_at = NOW(), acknowledged_by = :by
                WHERE id = :id AND tenant_id = :tenantId
                RETURNING *
                """)
                .param("id", id)
                .param("tenantId", tenantId)
                .param("by", acknowledgedBy)
                .query(NotificationRepository::mapNotification)
                .optional();
    }

    /**
     * Restart backstop for the in-memory dedup map: the newest persisted
     * Meldung for the same finding key and rule.
     */
    public Optional<Instant> lastCreatedAt(UUID tenantId, UUID ruleId, String type,
                                           String deviceId, int metricId) {
        return jdbc.sql("""
                SELECT max(created_at) AS last FROM notifications
                WHERE tenant_id = :tenantId
                  AND rule_id IS NOT DISTINCT FROM :ruleId
                  AND type = :type AND device_id = :deviceId AND metric_id = :metricId
                """)
                .param("tenantId", tenantId)
                .param("ruleId", ruleId)
                .param("type", type)
                .param("deviceId", deviceId)
                .param("metricId", metricId)
                .query((rs, i) -> {
                    Timestamp last = rs.getTimestamp("last");
                    return last == null ? null : last.toInstant();
                })
                .optional();
    }

    static Notification mapNotification(ResultSet rs, int rowNum) throws SQLException {
        Timestamp acknowledgedAt = rs.getTimestamp("acknowledged_at");
        return new Notification(
                rs.getObject("id", UUID.class),
                rs.getObject("tenant_id", UUID.class),
                rs.getObject("rule_id", UUID.class),
                rs.getString("type"),
                rs.getString("severity"),
                rs.getString("device_id"),
                rs.getInt("metric_id"),
                rs.getObject("asset_ref", UUID.class),
                rs.getString("summary"),
                rs.getString("detail"),
                rs.getTimestamp("detected_at").toInstant(),
                rs.getTimestamp("created_at").toInstant(),
                acknowledgedAt == null ? null : acknowledgedAt.toInstant(),
                rs.getString("acknowledged_by"));
    }
}
