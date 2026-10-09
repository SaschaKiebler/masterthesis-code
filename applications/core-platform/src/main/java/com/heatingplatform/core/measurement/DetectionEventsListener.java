package com.heatingplatform.core.measurement;

import com.heatingplatform.core.event.EventService;
import com.heatingplatform.core.metricpoint.MetricPoint;
import com.heatingplatform.core.metricpoint.MetricPointRepository;
import com.heatingplatform.core.ontology.ObjectEntity;
import com.heatingplatform.core.ontology.OntologyService;
import com.heatingplatform.detection.proto.v1.DetectionEvent;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.protobuf.InvalidProtocolBufferException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Projects detection events from the event backbone into core's events table,
 * which backs the tenant-facing event log in the web app.
 *
 * With detection moved to the analytics service (thesis ch. 4: the analytics
 * detector publishes findings as detection events), core no longer records
 * events synchronously during evaluation. Instead it consumes the shared
 * detection envelope from {@code threshold.breached} and
 * {@code anomaly.detected} and materialises each finding as an event row —
 * the same choreography the notification service follows for its Meldungen.
 */
@Slf4j
@Component
@RequiredArgsConstructor
@ConditionalOnProperty(name = "kafka.enabled", havingValue = "true", matchIfMissing = true)
public class DetectionEventsListener {

    private final EventService eventService;
    private final MetricPointRepository metricPointRepository;
    private final OntologyService ontologyService;

    private static final ObjectMapper objectMapper = new ObjectMapper();

    @KafkaListener(topics = {
            "${kafka.topics.threshold-breached}",
            "${kafka.topics.anomaly-detected}"
    })
    public void onMessage(byte[] payload) {
        DetectionEvent event;
        try {
            event = DetectionEvent.parseFrom(payload);
        } catch (InvalidProtocolBufferException e) {
            // Poison message — non-retryable, goes straight to the DLQ.
            throw new IllegalArgumentException("Payload is not a valid DetectionEvent protobuf", e);
        }

        try {
            record(event);
        } catch (Exception ex) {
            log.error("Failed to record detection event type={} device={}",
                    event.getType(), event.getChannel().getDeviceId(), ex);
        }
    }

    private void record(DetectionEvent event) {
        UUID metricPointId = parseUuid(event.getAssetRef());
        if (metricPointId == null) {
            log.warn("Detection event without usable asset_ref ({}) — skipping", event.getAssetRef());
            return;
        }

        // Events are recorded on the parent asset (inbound HAS_METRIC link),
        // falling back to the metric point itself.
        List<ObjectEntity> parents =
                ontologyService.getInboundNeighbors(metricPointId, OntologyService.HAS_METRIC);
        UUID objectId = parents.isEmpty() ? metricPointId : parents.get(0).getId();

        // Tenant: prefer the envelope (set by the detector from rule config),
        // fall back to resolving the metric point's owning tenant.
        UUID tenantId = parseUuid(event.getTenantId());
        if (tenantId == null) {
            tenantId = resolveTenant(metricPointId);
        }
        if (tenantId == null) {
            log.warn("Detection event for metric_point {} has no resolvable tenant — skipping",
                    metricPointId);
            return;
        }

        String eventType = mapEventType(event);
        String summary = event.getSummary().isBlank()
                ? "%s on metric %s".formatted(event.getType(), metricPointId)
                : event.getSummary();
        Instant time = event.hasDetectedAt()
                ? Instant.ofEpochSecond(event.getDetectedAt().getSeconds(), event.getDetectedAt().getNanos())
                : Instant.now();

        eventService.recordEvent(
                objectId,
                eventType,
                event.getSeverity().isBlank() ? "INFO" : event.getSeverity(),
                summary,
                event.getDetail().isBlank() ? "{}" : event.getDetail(),
                "SYSTEM",
                metricPointId,
                tenantId,
                time
        );
    }

    /**
     * threshold.breached carries both plain threshold breaches and state
     * changes; the operator inside the detail JSON tells them apart (the same
     * distinction the in-core evaluator made). Anomaly detections map to the
     * FAULT event type, which the event log already renders.
     */
    private String mapEventType(DetectionEvent event) {
        if ("anomaly.detected".equals(event.getType())) {
            return "FAULT";
        }
        try {
            JsonNode detail = objectMapper.readTree(event.getDetail());
            String operator = detail.path("operator").asText("");
            if (operator.startsWith("CHANGED_TO")) {
                return "STATE_CHANGE";
            }
        } catch (Exception ignored) {
            // fall through to the default
        }
        return "THRESHOLD_BREACH";
    }

    private UUID resolveTenant(UUID metricPointId) {
        try {
            Optional<MetricPoint> mp = metricPointRepository.findById(metricPointId);
            if (mp.isEmpty()) return null;
            ObjectEntity obj = ontologyService.getObject(metricPointId);
            return obj.getTenant() != null ? obj.getTenant().getId() : null;
        } catch (Exception e) {
            return null;
        }
    }

    private static UUID parseUuid(String value) {
        if (value == null || value.isBlank()) return null;
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
