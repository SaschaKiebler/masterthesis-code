package com.digitaldemon.core.measurement;

import com.digitaldemon.core.ontology.OntologyService;
import com.digitaldemon.core.event.EventService;

import com.digitaldemon.core.metricpoint.MetricPoint;
import com.digitaldemon.core.ontology.ObjectEntity;
import com.digitaldemon.core.thresholdrule.ThresholdRule;
import com.digitaldemon.core.proto.v1.IngestedMeasurement;
import com.digitaldemon.core.proto.v1.MeasurementBatch;
import com.digitaldemon.core.metricpoint.MetricPointRepository;
import com.digitaldemon.core.thresholdrule.ThresholdRuleRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Evaluates incoming measurement batches against configured threshold rules
 * and fires events via EventService when a rule is breached.
 *
 * Called by MeasurementBatchListener after deserialising a MeasurementBatch
 * protobuf from the measurement.ingested Kafka topic.
 *
 * Each evaluate() call runs in its own transaction so a failure on one metric
 * point does not roll back events already recorded for others in the batch.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class MeasurementEventEvaluator {

    private final MetricPointRepository metricPointRepository;
    private final ThresholdRuleRepository thresholdRuleRepository;
    private final EventService eventService;
    private final OntologyService ontologyService;

    /** Provider because the publisher bean only exists when kafka.enabled=true. */
    private final ObjectProvider<DetectionEventPublisher> detectionEventPublisher;

    /**
     * In-memory cooldown tracker: ruleId → time the last event was fired.
     * Resets on application restart — acceptable, guards against sustained re-fires.
     */
    private final ConcurrentHashMap<UUID, Instant> lastFired = new ConcurrentHashMap<>();

    /**
     * Last known value per metric point: metricPointId → previous measurement value.
     * Required for state-change operators (CHANGED_TO_TRUE / CHANGED_TO_FALSE) to
     * detect transitions. Resets on restart, so the first measurement after a restart
     * will not fire a change event (previous == null → isTriggered returns false).
     */
    private final ConcurrentHashMap<UUID, Double> lastKnownValue = new ConcurrentHashMap<>();

    /**
     * Entry point called from MeasurementBatchListener on the Kafka listener thread.
     * Loops over each measurement and delegates to evaluatePoint() per metric.
     */
    public void evaluate(MeasurementBatch batch) {
        String deviceId = batch.getDeviceId();
        for (IngestedMeasurement m : batch.getMeasurementsList()) {
            try {
                evaluatePoint(deviceId, (short) m.getMetricId(), m.getValue());
            } catch (Exception e) {
                log.warn("Error evaluating metric_id={} device={}: {}", m.getMetricId(), deviceId, e.getMessage());
            }
        }
    }

    /**
     * Evaluates a single (deviceId, metricId, value) triple against all active
     * threshold rules for the resolved metric point.
     *
     * Each call is its own transaction so events are committed independently.
     */
    @Transactional
    public void evaluatePoint(String deviceId, short metricId, double value) {
        Optional<MetricPoint> mpOpt = metricPointRepository.findByDeviceIdAndMetricId(deviceId, metricId);
        if (mpOpt.isEmpty()) {
            log.debug("No metric_point for device={} metric_id={} — skipping", deviceId, metricId);
            return;
        }

        MetricPoint mp = mpOpt.get();
        List<ThresholdRule> rules = thresholdRuleRepository.findByMetricPointIdAndEnabledTrue(mp.getId());
        if (rules.isEmpty()) return;

        // Resolve the parent asset via inbound HAS_METRIC link: asset → metric_point.
        // Events are recorded on the asset object, not the metric_point itself.
        List<ObjectEntity> parents = ontologyService.getInboundNeighbors(mp.getId(), OntologyService.HAS_METRIC);
        UUID objectId = parents.isEmpty() ? mp.getId() : parents.get(0).getId();

        // Resolve tenant from the metric_point's entry in the objects table.
        ObjectEntity mpObj = ontologyService.getObject(mp.getId());
        if (mpObj.getTenant() == null) {
            log.warn("metric_point {} has no tenant — cannot record event", mp.getId());
            return;
        }
        UUID tenantId = mpObj.getTenant().getId();

        // Look up previous value for state-change transition detection.
        Double previousValue = lastKnownValue.get(mp.getId());

        for (ThresholdRule rule : rules) {
            if (!rule.isTriggered(value, previousValue)) continue;

            // Cooldown check — prevents event spam for sustained breaches / rapid flapping.
            Instant now = Instant.now();
            Instant last = lastFired.get(rule.getId());
            if (last != null && now.isBefore(last.plusSeconds(rule.getCooldownSeconds()))) {
                log.debug("Rule {} cooldown active ({}s remaining) — skipping",
                        rule.getId(), rule.getCooldownSeconds() - last.until(now, java.time.temporal.ChronoUnit.SECONDS));
                continue;
            }

            // Build structured details JSON for the event.
            boolean isStateChange = rule.getOperator().startsWith("CHANGED_TO");
            String details;
            String summary;
            if (isStateChange) {
                details = """
                        {"value":%s,"previous":%s,"direction":"%s","operator":"%s","metric_point_id":"%s"}"""
                        .formatted(value, previousValue, rule.direction(), rule.getOperator(), mp.getId())
                        .strip();
                summary = "State changed to %s on metric %s"
                        .formatted(rule.direction(), mp.getId());
            } else {
                details = """
                        {"value":%s,"threshold":%s,"direction":"%s","operator":"%s","metric_point_id":"%s"}"""
                        .formatted(value, rule.getThreshold(), rule.direction(), rule.getOperator(), mp.getId())
                        .strip();
                summary = "Value %.4g %s threshold %.4g on metric %s"
                        .formatted(value, rule.direction().toLowerCase(), rule.getThreshold(), mp.getId());
            }

            String eventType = isStateChange ? "STATE_CHANGE" : "THRESHOLD_BREACH";
            eventService.recordEvent(
                    objectId,
                    eventType,
                    rule.getSeverity(),
                    summary,
                    details,
                    "SYSTEM",
                    mp.getId(),
                    tenantId
            );

            lastFired.put(rule.getId(), now);
            log.info("Rule fired: device={} metric_id={} operator={} value={} previous={} severity={}",
                    deviceId, metricId, rule.getOperator(), value, previousValue, rule.getSeverity());

            // Fan out to notification policy via the detection-event envelope.
            final String detailJson = details;
            detectionEventPublisher.ifAvailable(publisher ->
                    publisher.publishThresholdBreached(deviceId, metricId, mp.getId(),
                            rule.getSeverity(), detailJson));
        }

        // Always update last known value after evaluation (even if no rules fired).
        lastKnownValue.put(mp.getId(), value);
    }
}
