package com.digitaldemon.core.device;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;

/**
 * A device seen on the MQTT broker without configuration, as announced by
 * device-management via the device.discovered topic. Registry material for
 * the onboarding UI; rows are upserted per device and disappear from
 * relevance once the device is configured.
 */
@Entity
@Table(name = "discovered_devices")
@Getter
@Setter
@NoArgsConstructor
public class DiscoveredDevice {

    @Id
    @Column(name = "device_id")
    private String deviceId;

    private String protocol;

    @Column(name = "sample_topic")
    private String sampleTopic;

    @Column(name = "sample_payload")
    private String samplePayload;

    @Column(name = "first_seen_at", nullable = false)
    private Instant firstSeenAt;

    @Column(name = "last_seen_at", nullable = false)
    private Instant lastSeenAt;
}
