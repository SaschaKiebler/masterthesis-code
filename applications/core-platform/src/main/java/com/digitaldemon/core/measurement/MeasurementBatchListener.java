package com.digitaldemon.core.measurement;

import com.digitaldemon.core.proto.v1.MeasurementBatch;
import com.digitaldemon.core.kpiformula.KpiFormulaEvaluator;
import com.digitaldemon.core.measurement.MeasurementEventEvaluator;
import com.google.protobuf.InvalidProtocolBufferException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.concurrent.CompletableFuture;

/**
 * Receives raw protobuf payloads from the Mosquitto MQTT broker,
 * deserialises them into MeasurementBatch messages, and dispatches
 * evaluation to both the threshold evaluator and the KPI formula evaluator
 * on a separate thread so the Paho callback thread is never blocked.
 *
 * Evaluation pipeline (sequential within the async task):
 * 1. {@link MeasurementEventEvaluator} — threshold rule breach detection and event recording.
 * 2. {@link KpiFormulaEvaluator} — KPI formula evaluation and derived property persistence.
 *
 * A failure in KPI evaluation is caught and logged without affecting threshold evaluation
 * results already committed in step 1.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class MeasurementBatchListener {

    private final MeasurementEventEvaluator evaluator;
    private final KpiFormulaEvaluator kpiFormulaEvaluator;

    /**
     * Called by MqttSubscriberConfig on every message from heizung/measurements/processed.
     * Runs on the Paho network thread — must return immediately.
     */
    public void onMessage(byte[] payload) {
        try {
            MeasurementBatch batch = MeasurementBatch.parseFrom(payload);
            // Dispatch off the Paho thread so we never block MQTT keep-alives.
            CompletableFuture.runAsync(() -> {
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
            }).exceptionally(ex -> {
                log.error("Uncaught error in batch evaluation for device={}",
                        batch.getDeviceId(), ex);
                return null;
            });
        } catch (InvalidProtocolBufferException e) {
            log.warn("Failed to deserialise MeasurementBatch — payload may not be protobuf: {}",
                    e.getMessage());
        }
    }
}
