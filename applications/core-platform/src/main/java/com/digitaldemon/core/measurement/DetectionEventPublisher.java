package com.digitaldemon.core.measurement;

import com.digitaldemon.core.common.config.KafkaTopicsProperties;
import com.digitaldemon.detection.proto.v1.Channel;
import com.digitaldemon.detection.proto.v1.DetectionEvent;
import com.google.protobuf.Timestamp;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.UUID;

/**
 * Publishes threshold.breached detection events (shared envelope, see
 * apis/proto/detection/v1) keyed by device id. Consumed by the notification
 * service; the events table write remains the tenant-facing record, this is
 * the fan-out to notification policy.
 *
 * Fire-and-forget: the event row is already committed when this runs, so a
 * publish failure is logged and never propagates into evaluation.
 */
@Slf4j
@Component
@RequiredArgsConstructor
@ConditionalOnProperty(name = "kafka.enabled", havingValue = "true", matchIfMissing = true)
public class DetectionEventPublisher {

    private final KafkaTemplate<Object, Object> kafka;
    private final KafkaTopicsProperties topics;

    public void publishThresholdBreached(String deviceId, int metricId, UUID assetRef,
                                         String severity, String detailJson) {
        String topic = topics.getTopics().getThresholdBreached();
        Instant now = Instant.now();

        DetectionEvent event = DetectionEvent.newBuilder()
                .setType(topic)
                .setSeverity(severity)
                .setChannel(Channel.newBuilder()
                        .setDeviceId(deviceId)
                        .setMetricId(metricId))
                .setAssetRef(assetRef.toString())
                .setDetectedAt(Timestamp.newBuilder()
                        .setSeconds(now.getEpochSecond())
                        .setNanos(now.getNano()))
                .setDetail(detailJson)
                .build();

        try {
            kafka.send(topic, deviceId.getBytes(StandardCharsets.UTF_8), event.toByteArray());
        } catch (Exception e) {
            log.warn("Failed to publish {} for device={} — notification skipped for this event: {}",
                    topic, deviceId, e.getMessage());
        }
    }
}
