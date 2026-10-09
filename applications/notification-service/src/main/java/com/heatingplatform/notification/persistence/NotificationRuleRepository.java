package com.heatingplatform.notification.persistence;

import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
@RequiredArgsConstructor
public class NotificationRuleRepository {

    private final JdbcClient jdbc;

    public List<NotificationRule> findByTenant(UUID tenantId) {
        return jdbc.sql("""
                SELECT * FROM notification_rules
                WHERE tenant_id = :tenantId
                ORDER BY created_at
                """)
                .param("tenantId", tenantId)
                .query(NotificationRuleRepository::mapRule)
                .list();
    }

    public List<NotificationRule> findEnabledByTenant(UUID tenantId) {
        return jdbc.sql("""
                SELECT * FROM notification_rules
                WHERE tenant_id = :tenantId AND enabled
                ORDER BY created_at
                """)
                .param("tenantId", tenantId)
                .query(NotificationRuleRepository::mapRule)
                .list();
    }

    public Optional<NotificationRule> findByIdAndTenant(UUID id, UUID tenantId) {
        return jdbc.sql("SELECT * FROM notification_rules WHERE id = :id AND tenant_id = :tenantId")
                .param("id", id)
                .param("tenantId", tenantId)
                .query(NotificationRuleRepository::mapRule)
                .optional();
    }

    public NotificationRule insert(UUID tenantId, String name, List<String> eventTypes,
                                   String minSeverity, int cooldownMinutes,
                                   String webhookUrl, String webhookToken, boolean enabled) {
        return jdbc.sql("""
                INSERT INTO notification_rules
                    (tenant_id, name, event_types, min_severity, cooldown_minutes,
                     webhook_url, webhook_token, enabled)
                VALUES (:tenantId, :name, CAST(:eventTypes AS text[]), :minSeverity,
                        :cooldownMinutes, :webhookUrl, :webhookToken, :enabled)
                RETURNING *
                """)
                .param("tenantId", tenantId)
                .param("name", name)
                .param("eventTypes", toArrayLiteral(eventTypes))
                .param("minSeverity", minSeverity)
                .param("cooldownMinutes", cooldownMinutes)
                .param("webhookUrl", webhookUrl)
                .param("webhookToken", webhookToken)
                .param("enabled", enabled)
                .query(NotificationRuleRepository::mapRule)
                .single();
    }

    public Optional<NotificationRule> update(UUID id, UUID tenantId, String name,
                                             List<String> eventTypes, String minSeverity,
                                             Integer cooldownMinutes, String webhookUrl,
                                             String webhookToken, Boolean enabled) {
        return jdbc.sql("""
                UPDATE notification_rules SET
                    name             = COALESCE(:name, name),
                    event_types      = COALESCE(CAST(:eventTypes AS text[]), event_types),
                    min_severity     = COALESCE(:minSeverity, min_severity),
                    cooldown_minutes = COALESCE(:cooldownMinutes, cooldown_minutes),
                    webhook_url      = COALESCE(:webhookUrl, webhook_url),
                    webhook_token    = COALESCE(:webhookToken, webhook_token),
                    enabled          = COALESCE(:enabled, enabled),
                    updated_at       = NOW()
                WHERE id = :id AND tenant_id = :tenantId
                RETURNING *
                """)
                .param("id", id)
                .param("tenantId", tenantId)
                .param("name", name)
                .param("eventTypes", eventTypes == null ? null : toArrayLiteral(eventTypes))
                .param("minSeverity", minSeverity)
                .param("cooldownMinutes", cooldownMinutes)
                .param("webhookUrl", webhookUrl)
                .param("webhookToken", webhookToken)
                .param("enabled", enabled)
                .query(NotificationRuleRepository::mapRule)
                .optional();
    }

    public boolean delete(UUID id, UUID tenantId) {
        return jdbc.sql("DELETE FROM notification_rules WHERE id = :id AND tenant_id = :tenantId")
                .param("id", id)
                .param("tenantId", tenantId)
                .update() > 0;
    }

    /** PostgreSQL array literal ('{a,b}') so the text[] cast binds cleanly. */
    private static String toArrayLiteral(List<String> values) {
        return "{" + String.join(",", values) + "}";
    }

    static NotificationRule mapRule(ResultSet rs, int rowNum) throws SQLException {
        String[] eventTypes = (String[]) rs.getArray("event_types").getArray();
        return new NotificationRule(
                rs.getObject("id", UUID.class),
                rs.getObject("tenant_id", UUID.class),
                rs.getString("name"),
                Arrays.asList(eventTypes),
                rs.getString("min_severity"),
                rs.getInt("cooldown_minutes"),
                rs.getString("webhook_url"),
                rs.getString("webhook_token"),
                rs.getBoolean("enabled"),
                rs.getTimestamp("created_at").toInstant(),
                rs.getTimestamp("updated_at").toInstant());
    }
}
