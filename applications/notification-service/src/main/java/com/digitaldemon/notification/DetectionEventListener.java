package com.digitaldemon.notification;

import com.digitaldemon.detection.proto.v1.DetectionEvent;
import com.digitaldemon.notification.delivery.AlertDeliverer;
import com.google.protobuf.InvalidProtocolBufferException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

/**
 * Consumes all detection-event topics (shared envelope, see
 * apis/proto/detection/v1). Detectors fan in here; channels fan out from
 * {@link AlertDeliverer}.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class DetectionEventListener {

    private final NotificationPolicy policy;
    private final AlertDeliverer deliverer;

    @KafkaListener(topics = "#{@notificationProperties.topics}")
    public void onMessage(byte[] payload) {
        DetectionEvent event;
        try {
            event = DetectionEvent.parseFrom(payload);
        } catch (InvalidProtocolBufferException e) {
            // Poison message — non-retryable, goes to <topic>.dlq.
            throw new IllegalArgumentException("Payload is not a valid DetectionEvent protobuf", e);
        }

        if (!policy.shouldNotify(event)) {
            return;
        }

        deliverer.deliver(event);
    }
}
