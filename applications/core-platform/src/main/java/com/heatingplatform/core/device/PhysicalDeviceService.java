package com.heatingplatform.core.device;

import com.heatingplatform.core.ontology.OntologyService;

import com.heatingplatform.core.device.PhysicalDevice;
import com.heatingplatform.core.common.exception.ResourceNotFoundException;
import com.heatingplatform.core.device.PhysicalDeviceRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Slf4j
@Transactional(readOnly = true)
public class PhysicalDeviceService {

    private final PhysicalDeviceRepository physicalDeviceRepository;
    private final OntologyService ontologyService;

    public Optional<PhysicalDevice> findById(UUID id) {
        return physicalDeviceRepository.findById(id);
    }

    public Optional<PhysicalDevice> findByDeviceId(String deviceId) {
        return physicalDeviceRepository.findByDeviceId(deviceId);
    }

    /**
     * Find or create a PhysicalDevice for the given hardware device_id.
     * Used during signal_map migration and device commissioning.
     * The REALIZED_BY link from the asset is created by the caller.
     */
    @Transactional
    public PhysicalDevice findOrCreateByDeviceId(String deviceId, String model, String protocol,
                                                  UUID tenantId) {
        return physicalDeviceRepository.findByDeviceId(deviceId).orElseGet(() -> {
            UUID id = UUID.randomUUID();
            String displayName = model != null ? model + " (" + deviceId + ")" : deviceId;
            ontologyService.registerObject(id, OntologyService.PHYSICAL_DEVICE, tenantId, displayName);

            PhysicalDevice device = new PhysicalDevice();
            device.setId(id);
            device.setDeviceId(deviceId);
            device.setModel(model);
            device.setProtocol(protocol);
            device.setSecrets("{}");
            device.setCreatedAt(Instant.now());
            device.setUpdatedAt(Instant.now());

            PhysicalDevice saved = physicalDeviceRepository.save(device);
            log.info("Created physical device: {} ({})", deviceId, id);
            return saved;
        });
    }

    @Transactional
    public PhysicalDevice updateDevice(UUID id, String manufacturer, String model,
                                       String firmwareVersion, String protocol) {
        PhysicalDevice device = physicalDeviceRepository.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException("PhysicalDevice", id));

        if (manufacturer != null) device.setManufacturer(manufacturer);
        if (model != null) device.setModel(model);
        if (firmwareVersion != null) device.setFirmwareVersion(firmwareVersion);
        if (protocol != null) device.setProtocol(protocol);
        device.setUpdatedAt(Instant.now());

        return physicalDeviceRepository.save(device);
    }

    @Transactional
    public void decommission(UUID id) {
        PhysicalDevice device = physicalDeviceRepository.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException("PhysicalDevice", id));
        device.setDecommissionedAt(Instant.now());
        device.setUpdatedAt(Instant.now());
        physicalDeviceRepository.save(device);
        log.info("Decommissioned physical device: {}", device.getDeviceId());
    }
}
