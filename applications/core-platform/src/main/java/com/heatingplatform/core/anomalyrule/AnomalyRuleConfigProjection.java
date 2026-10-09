package com.heatingplatform.core.anomalyrule;

import com.heatingplatform.core.common.config.KafkaTopicsProperties;
import com.heatingplatform.detection.proto.v1.AnomalyRuleConfig;
import com.heatingplatform.detection.proto.v1.ChannelBinding;
import com.google.protobuf.Timestamp;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Publishes the enabled anomaly rules to the compacted
 * {@code anomaly-rule.configured} topic (key = rule_id), the exact mechanism
 * of {@link com.heatingplatform.core.thresholdrule.ThresholdRuleConfigProjection}
 * for threshold rules: periodic reconciliation sweep, fingerprint diffing,
 * tombstones for deleted or disabled rules, immediate sweep after CRUD.
 *
 * Channel identity is denormalised from metric_points at publish time so the
 * analytics engine never reads the registry. Rules with a binding whose
 * metric point no longer exists are skipped (and eventually tombstoned).
 */
@Slf4j
@Component
@RequiredArgsConstructor
@ConditionalOnProperty(name = "kafka.enabled", havingValue = "true", matchIfMissing = true)
public class AnomalyRuleConfigProjection {

    private final JdbcTemplate jdbc;
    private final KafkaTemplate<Object, Object> kafka;
    private final KafkaTopicsProperties props;

    /** Fingerprints of the last published config per rule id. */
    private final ConcurrentHashMap<String, Integer> published = new ConcurrentHashMap<>();

    @Scheduled(fixedDelayString = "${kafka.rule-projection.sweep-interval-ms:30000}", initialDelay = 2000)
    public synchronized void sweep() {
        try {
            Map<String, AnomalyRuleConfig.Builder> configs = loadEnabledRules();

            int publishedCount = 0;
            for (Map.Entry<String, AnomalyRuleConfig.Builder> entry : configs.entrySet()) {
                String ruleId = entry.getKey();
                AnomalyRuleConfig.Builder builder = entry.getValue();

                // Fingerprint over the config content only (updated_at excluded,
                // otherwise every sweep would look like a change).
                int fingerprint = Arrays.hashCode(builder.build().toByteArray());
                Integer previous = published.get(ruleId);
                if (previous != null && previous == fingerprint) {
                    continue;
                }

                Instant now = Instant.now();
                AnomalyRuleConfig config = builder
                        .setUpdatedAt(Timestamp.newBuilder()
                                .setSeconds(now.getEpochSecond())
                                .setNanos(now.getNano()))
                        .build();

                kafka.send(props.getTopics().getAnomalyRuleConfigured(),
                        ruleId.getBytes(StandardCharsets.UTF_8),
                        config.toByteArray());
                published.put(ruleId, fingerprint);
                publishedCount++;
            }

            // Tombstones for rules that were deleted, disabled or became unresolvable.
            int tombstones = 0;
            for (String ruleId : new ArrayList<>(published.keySet())) {
                if (!configs.containsKey(ruleId)) {
                    kafka.send(props.getTopics().getAnomalyRuleConfigured(),
                            ruleId.getBytes(StandardCharsets.UTF_8),
                            null);
                    published.remove(ruleId);
                    tombstones++;
                }
            }

            if (publishedCount > 0 || tombstones > 0) {
                log.info("Anomaly-rule sweep: {} published, {} tombstoned", publishedCount, tombstones);
            }
        } catch (Exception e) {
            log.error("Anomaly-rule sweep failed: {}", e.getMessage(), e);
        }
    }

    private Map<String, AnomalyRuleConfig.Builder> loadEnabledRules() {
        record Row(String ruleId, String tenantId, String name, String detector, String params,
                   String severity, int cooldownSeconds,
                   String role, String metricPointId, String deviceId, Integer metricId) {}

        var rows = jdbc.query("""
                SELECT ar.id, ar.tenant_id, ar.name, ar.detector, ar.params::text AS params,
                       ar.severity, ar.cooldown_seconds,
                       b.value ->> 'role' AS role,
                       b.value ->> 'metricPointId' AS metric_point_id,
                       mp.device_id, mp.metric_id
                FROM anomaly_rules ar
                CROSS JOIN LATERAL jsonb_array_elements(ar.bindings)
                     WITH ORDINALITY b(value, ordinality)
                LEFT JOIN metric_points mp ON mp.id = (b.value ->> 'metricPointId')::uuid
                WHERE ar.enabled = TRUE
                ORDER BY ar.id, b.ordinality
                """, (rs, i) -> new Row(
                rs.getString("id"), rs.getString("tenant_id"), rs.getString("name"),
                rs.getString("detector"), rs.getString("params"), rs.getString("severity"),
                rs.getInt("cooldown_seconds"), rs.getString("role"),
                rs.getString("metric_point_id"), rs.getString("device_id"),
                rs.getObject("metric_id") == null ? null : rs.getInt("metric_id")));

        Map<String, AnomalyRuleConfig.Builder> configs = new LinkedHashMap<>();
        Set<String> unresolvable = new LinkedHashSet<>();
        for (Row row : rows) {
            if (row.deviceId() == null || row.metricId() == null) {
                unresolvable.add(row.ruleId());
                continue;
            }
            AnomalyRuleConfig.Builder builder = configs.computeIfAbsent(row.ruleId(), id ->
                    AnomalyRuleConfig.newBuilder()
                            .setRuleId(id)
                            .setTenantId(row.tenantId())
                            .setName(row.name())
                            .setDetector(row.detector())
                            .setParamsJson(row.params())
                            .setSeverity(row.severity())
                            .setCooldownSeconds(row.cooldownSeconds()));
            builder.addBindings(ChannelBinding.newBuilder()
                    .setRole(row.role())
                    .setMetricPointId(row.metricPointId())
                    .setDeviceId(row.deviceId())
                    .setMetricId(row.metricId()));
        }
        for (String ruleId : unresolvable) {
            configs.remove(ruleId);
            log.warn("Anomaly rule {} has a binding to a missing metric point — not publishing", ruleId);
        }
        return configs;
    }
}
