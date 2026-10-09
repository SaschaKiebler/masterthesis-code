package com.heatingplatform.core.thresholdrule;

import com.heatingplatform.core.common.config.KafkaTopicsProperties;
import com.heatingplatform.detection.proto.v1.RuleConfig;
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
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Publishes the enabled threshold rules to the compacted {@code rule.configured}
 * topic (key = rule_id), mirroring device-management's DeviceConfigProjection.
 *
 * Core owns the rule CONFIG (rules are maintained next to the ontology objects
 * they refer to), the analytics service owns the rule EVALUATION on the
 * measurement path (thesis ch. 4). The evaluator rebuilds its rule state by
 * replaying this topic — event-carried state transfer, no registry read.
 *
 * A periodic reconciliation sweep diffs the current database state against
 * what was last published and emits only changes: updated snapshots for new
 * or changed rules, tombstones for rules that were deleted or disabled. The
 * first sweep after startup publishes everything once. CRUD operations in
 * {@link ThresholdRuleService} additionally trigger an immediate sweep so
 * changes propagate without waiting for the interval.
 */
@Slf4j
@Component
@RequiredArgsConstructor
@ConditionalOnProperty(name = "kafka.enabled", havingValue = "true", matchIfMissing = true)
public class ThresholdRuleConfigProjection {

    private final JdbcTemplate jdbc;
    private final KafkaTemplate<Object, Object> kafka;
    private final KafkaTopicsProperties props;

    /** Fingerprints of the last published config per rule id. */
    private final ConcurrentHashMap<String, Integer> published = new ConcurrentHashMap<>();

    @Scheduled(fixedDelayString = "${kafka.rule-projection.sweep-interval-ms:30000}", initialDelay = 2000)
    public synchronized void sweep() {
        try {
            Map<String, RuleConfig.Builder> configs = loadEnabledRules();

            int publishedCount = 0;
            for (Map.Entry<String, RuleConfig.Builder> entry : configs.entrySet()) {
                String ruleId = entry.getKey();
                RuleConfig.Builder builder = entry.getValue();

                // Fingerprint over the config content only (updated_at excluded,
                // otherwise every sweep would look like a change).
                int fingerprint = Arrays.hashCode(builder.build().toByteArray());
                Integer previous = published.get(ruleId);
                if (previous != null && previous == fingerprint) {
                    continue;
                }

                Instant now = Instant.now();
                RuleConfig config = builder
                        .setUpdatedAt(Timestamp.newBuilder()
                                .setSeconds(now.getEpochSecond())
                                .setNanos(now.getNano()))
                        .build();

                kafka.send(props.getTopics().getRuleConfigured(),
                        ruleId.getBytes(StandardCharsets.UTF_8),
                        config.toByteArray());
                published.put(ruleId, fingerprint);
                publishedCount++;
            }

            // Tombstones for rules that were deleted or disabled.
            int tombstones = 0;
            for (String ruleId : new ArrayList<>(published.keySet())) {
                if (!configs.containsKey(ruleId)) {
                    kafka.send(props.getTopics().getRuleConfigured(),
                            ruleId.getBytes(StandardCharsets.UTF_8),
                            null);
                    published.remove(ruleId);
                    tombstones++;
                }
            }

            if (publishedCount > 0 || tombstones > 0) {
                log.info("Rule-config sweep: {} published, {} tombstoned", publishedCount, tombstones);
            }
        } catch (Exception e) {
            log.error("Rule-config sweep failed: {}", e.getMessage(), e);
        }
    }

    /**
     * Load every enabled rule with its channel identity denormalised from
     * metric_points, so the evaluator never needs a registry read.
     */
    private Map<String, RuleConfig.Builder> loadEnabledRules() {
        return jdbc.query("""
                SELECT tr.id, tr.metric_point_id, tr.operator, tr.threshold,
                       tr.severity, tr.cooldown_seconds, tr.tenant_id,
                       mp.device_id, mp.metric_id
                FROM threshold_rules tr
                JOIN metric_points mp ON mp.id = tr.metric_point_id
                WHERE tr.enabled = TRUE
                ORDER BY tr.id
                """, rs -> {
            Map<String, RuleConfig.Builder> configs = new LinkedHashMap<>();
            while (rs.next()) {
                String ruleId = rs.getString("id");
                RuleConfig.Builder builder = RuleConfig.newBuilder()
                        .setRuleId(ruleId)
                        .setMetricPointId(rs.getString("metric_point_id"))
                        .setDeviceId(rs.getString("device_id"))
                        .setMetricId(rs.getInt("metric_id"))
                        .setOperator(rs.getString("operator"))
                        .setSeverity(rs.getString("severity"))
                        .setCooldownSeconds(rs.getInt("cooldown_seconds"))
                        .setTenantId(rs.getString("tenant_id"));
                double threshold = rs.getDouble("threshold");
                if (!rs.wasNull()) {
                    builder.setThreshold(threshold);
                }
                configs.put(ruleId, builder);
            }
            return configs;
        });
    }
}
