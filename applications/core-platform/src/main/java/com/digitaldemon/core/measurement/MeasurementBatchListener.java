package com.digitaldemon.core.measurement;

import com.digitaldemon.core.proto.v1.MeasurementBatch;
import com.digitaldemon.core.kpiformula.KpiFormulaEvaluator;
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
 * offset is only committed after both evaluators finished: at-least-once
 * processing, ordered per device via the message key.
 *
 * Evaluation pipeline:
 * 1. {@link MeasurementEventEvaluator} — threshold rule breach detection and event recording.
 * 2. {@link KpiFormulaEvaluator} — KPI formula evaluation and derived property persistence.
 *
 * A failure inside an evaluator is caught and logged, not retried — identical
 * to the previous MQTT behaviour. Only undecodable payloads are thrown, which
 * routes them to {@code measurement.ingested.dlq} via the error handler in
 * {@link com.digitaldemon.core.common.config.KafkaConfig}.
 */
@Slf4j
@Component
@RequiredArgsConstructor
@ConditionalOnProperty(name = "kafka.enabled", havingValue = "true", matchIfMissing = true)
public class MeasurementBatchListener {

    private final MeasurementEventEvaluator evaluator;
    private final KpiFormulaEvaluator kpiFormulaEvaluator;

    @KafkaListener(topics = "${kafka.topics.measurement-ingested}")
    public void onMessage(byte[] payload) {
        MeasurementBatch batch;
        try {
            batch = MeasurementBatch.parseFrom(payload);
        } catch (InvalidProtocolBufferException e) {
            // Poison message — non-retryable, goes straight to the DLQ.
            throw new IllegalArgumentException("Payload is not a valid MeasurementBatch protobuf", e);
        }

        try {
            evaluator.evaluate(batch);
        } catch (Exception ex) {
            log.error("Uncaught error in MeasurementEventEvaluator for device={}",
                    batch.getDeviceId(), ex);
        }
        try {
            kpiFormulaEvaluator.evaluate(batch);
        } catch (Exception ex) {
            log.error("Uncaught error in KpiFormulaEvaluator for device={}",
                    batch.getDeviceId(), ex);
        }
    }
}
