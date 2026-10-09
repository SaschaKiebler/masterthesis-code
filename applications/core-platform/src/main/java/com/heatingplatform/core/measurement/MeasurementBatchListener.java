package com.heatingplatform.core.measurement;

import com.heatingplatform.core.proto.v1.MeasurementBatch;
import com.heatingplatform.core.kpiformula.KpiFormulaEvaluator;
import com.google.protobuf.InvalidProtocolBufferException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

/**
 * Consumes MeasurementBatch protobuf messages from the Kafka topic
 * {@code measurement.ingested} (published by the ingestion service, keyed by
 * device id) and dispatches evaluation.
 *
 * Evaluation runs synchronously on the listener container thread, so the
 * offset is only committed after the evaluator finished: at-least-once
 * processing, ordered per device via the message key.
 *
 * Threshold detection no longer happens here — the analytics service owns the
 * measurement-path evaluation and publishes detection events (thesis ch. 4).
 * Core keeps the rule config ({@link com.heatingplatform.core.thresholdrule.ThresholdRuleConfigProjection})
 * and projects incoming detection events into its events table
 * ({@link DetectionEventsListener}). What remains on this listener is the
 * {@link KpiFormulaEvaluator} for KPI formula evaluation.
 *
 * A failure inside the evaluator is caught and logged, not retried. Only
 * undecodable payloads are thrown, which routes them to
 * {@code measurement.ingested.dlq} via the error handler in
 * {@link com.heatingplatform.core.common.config.KafkaConfig}.
 */
@Slf4j
@Component
@RequiredArgsConstructor
@ConditionalOnProperty(name = "kafka.enabled", havingValue = "true", matchIfMissing = true)
public class MeasurementBatchListener {

    private final KpiFormulaEvaluator kpiFormulaEvaluator;
    private final LatestValueProjection latestValueProjection;

    @KafkaListener(topics = "${kafka.topics.measurement-ingested}")
    public void onMessage(byte[] payload) {
        MeasurementBatch batch;
        try {
            batch = MeasurementBatch.parseFrom(payload);
        } catch (InvalidProtocolBufferException e) {
            // Poison message — non-retryable, goes straight to the DLQ.
            throw new IllegalArgumentException("Payload is not a valid MeasurementBatch protobuf", e);
        }
        // Projection first: KPI evaluation reads the latest values it feeds.
        latestValueProjection.apply(batch);
        try {
            kpiFormulaEvaluator.evaluate(batch);
        } catch (Exception ex) {
            log.error("Uncaught error in KpiFormulaEvaluator for device={}", batch.getDeviceId(), ex);
        }
    }
}
