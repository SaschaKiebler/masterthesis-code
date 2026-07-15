package com.digitaldemon.core.device;

import com.digitaldemon.device.proto.v1.DeviceDiscovered;
import com.google.protobuf.InvalidProtocolBufferException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;

/**
 * Consumes device.discovered events from device-management and upserts them
 * into the discovered_devices registry table for the onboarding UI (see
 * docs/architecture/event-catalog.md, consumers "core registry, UI").
 */
@Slf4j
@Component
@RequiredArgsConstructor
@ConditionalOnProperty(name = "kafka.enabled", havingValue = "true", matchIfMissing = true)
public class DeviceDiscoveredListener {

    private final DiscoveredDeviceRepository repository;

    @KafkaListener(topics = "${kafka.topics.device-discovered}")
    @Transactional
    public void onMessage(byte[] payload) {
        DeviceDiscovered event;
        try {
            event = DeviceDiscovered.parseFrom(payload);
        } catch (InvalidProtocolBufferException e) {
            // Poison message — non-retryable, goes to device.discovered.dlq.
            throw new IllegalArgumentException("Payload is not a valid DeviceDiscovered protobuf", e);
        }

        Instant seenAt = event.hasSeenAt()
                ? Instant.ofEpochSecond(event.getSeenAt().getSeconds(), event.getSeenAt().getNanos())
                : Instant.now();

        DiscoveredDevice device = repository.findById(event.getDeviceId())
                .orElseGet(() -> {
                    DiscoveredDevice fresh = new DiscoveredDevice();
                    fresh.setDeviceId(event.getDeviceId());
                    fresh.setFirstSeenAt(seenAt);
                    return fresh;
                });

        device.setProtocol(event.getProtocol());
        device.setSampleTopic(event.getSampleTopic());
        device.setSamplePayload(event.getSamplePayload());
        device.setLastSeenAt(seenAt);

        repository.save(device);
        log.info("Discovered device upserted: {} (topic={})", event.getDeviceId(), event.getSampleTopic());
    }
}
