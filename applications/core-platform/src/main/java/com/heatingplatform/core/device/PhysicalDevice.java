package com.heatingplatform.core.device;

import jakarta.persistence.*;
import lombok.Data;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "physical_devices")
@Data
public class PhysicalDevice {

    @Id
    private UUID id; // Same UUID as objects.id — typed extension table pattern

    @Column(name = "device_id", unique = true, nullable = false)
    private String deviceId; // Factory hardware identifier (MAC, DevEUI, serial)

    @Column
    private String manufacturer;

    @Column
    private String model;

    @Column(name = "firmware_version")
    private String firmwareVersion;

    @Column
    private String protocol; // 'MQTT_SHELLY', 'MQTT_LORA', 'WMBUS', 'MODBUS'

    @Column(columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private String secrets; // Encryption keys / device credentials (never exposed via API)

    @Column(name = "commissioned_at")
    private Instant commissionedAt;

    @Column(name = "decommissioned_at")
    private Instant decommissionedAt;

    @Column(name = "created_at")
    private Instant createdAt;

    @Column(name = "updated_at")
    private Instant updatedAt;
}
