package com.heatingplatform.notification;

import com.heatingplatform.detection.proto.v1.DetectionEvent;
import com.heatingplatform.notification.delivery.AlertDeliverer;
import com.google.protobuf.InvalidProtocolBufferException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

import java.util.Optional;
import java.util.UUID;

/**
 * Consumes all detection-event topics (shared envelope, see
 * apis/proto/detection/v1). Detectors fan in here.
 *
 * Events with a tenant (set by the detector from the rule config since the
 * envelope carries tenant_id) run through the per-tenant rule set and become
 * persisted Meldungen ({@link MeldungService}). Events without tenant fall
 * back to the global properties policy and are delivered log-only — keeps
 * the service robust against detectors without tenant context.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class DetectionEventListener {

    private final NotificationPolicy policy;
    private final AlertDeliverer deliverer;
    private final MeldungService meldungService;

    @KafkaListener(topics = "#{@notificationProperties.topics}")
    public void onMessage(byte[] payload) {
        DetectionEvent event;
        try {
            event = DetectionEvent.parseFrom(payload);
        } catch (InvalidProtocolBufferException e) {
            // Poison message — non-retryable, goes to <topic>.dlq.
            throw new IllegalArgumentException("Payload is not a valid DetectionEvent protobuf", e);
        }

        Optional<UUID> tenantId = MeldungService.tenantOf(event);
        if (tenantId.isEmpty()) {
            // No tenant context: global policy, log-only delivery, no Meldung.
            if (policy.shouldNotify(event)) {
                log.info("Detection event without tenant — delivered log-only (device={})",
                        event.getChannel().getDeviceId());
                deliverer.deliver(event);
            }
            return;
        }

        meldungService.process(tenantId.get(), event);
    }
}
