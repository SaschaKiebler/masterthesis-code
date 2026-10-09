package com.heatingplatform.core.asset;

import com.heatingplatform.core.ontology.OntologyService;

import com.heatingplatform.core.asset.AssetDTO;
import com.heatingplatform.core.metricpoint.MetricPoint;
import com.heatingplatform.core.ontology.ObjectEntity;
import com.heatingplatform.core.device.PhysicalDevice;
import com.heatingplatform.core.common.exception.DuplicateResourceException;
import com.heatingplatform.core.common.exception.ResourceNotFoundException;
import com.heatingplatform.core.common.exception.ServiceException;
import com.heatingplatform.core.common.exception.ValidationException;
import com.heatingplatform.core.measurement.ChannelResolver;
import com.heatingplatform.core.metricpoint.MetricPointRepository;
import com.heatingplatform.core.ontology.ObjectRepository;
import com.heatingplatform.core.device.PhysicalDeviceRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;

@Service
@RequiredArgsConstructor
@Slf4j
@Transactional(readOnly = true)
public class AssetService {

    private final ChannelResolver channelResolver;
    private final OntologyService ontologyService;
    private final PhysicalDeviceRepository physicalDeviceRepository;
    private final MetricPointRepository metricPointRepository;
    private final ObjectRepository objectRepository;

    /**
     * Get all assets for a site/building via INSTALLED_AT links.
     */
    public List<AssetDTO> getAssetsBySite(UUID siteId) {
        List<UUID> assetIds = ontologyService.findSourceIds(siteId, OntologyService.INSTALLED_AT);
        if (assetIds.isEmpty()) return List.of();
        return objectRepository.findAllById(assetIds).stream()
            .map(this::toDTO)
            .toList();
    }

    /**
     * Get a single asset by ID.
     */
    public Optional<AssetDTO> getAssetById(UUID id) {
        log.debug("Fetching asset: {}", id);
        return objectRepository.findById(id)
            .map(this::toDTO);
    }

    /**
     * Channels of an asset (resolve-then-fetch): the asset's device channels,
     * optionally filtered like the former metrics parameter (metric-point
     * UUID, display name, or source). Series and latest values are fetched
     * from the analytics service by the BFF.
     */
    public Optional<List<ChannelResolver.Channel>> getChannels(UUID assetId, List<String> metricNames) {
        return objectRepository.findById(assetId)
            .map(obj -> {
                String deviceId = resolveDeviceId(assetId);
                List<ChannelResolver.Channel> channels = channelResolver.resolveDevice(deviceId);
                if (metricNames == null || metricNames.isEmpty()) {
                    return channels;
                }
                return channels.stream()
                    .filter(c -> metricNames.stream().anyMatch(name ->
                        name.equals(c.metricPointId().toString())
                            || name.equals(c.displayName())
                            || name.equals(c.source())))
                    .toList();
            });
    }

    private String resolveDeviceId(UUID assetId) {
        UUID physicalDeviceId = ontologyService.resolveTargetId(assetId, OntologyService.REALIZED_BY);
        if (physicalDeviceId == null) {
            log.debug("No REALIZED_BY link found for asset {}", assetId);
            return null;
        }
        return physicalDeviceRepository.findById(physicalDeviceId)
            .map(PhysicalDevice::getDeviceId)
            .orElse(null);
    }

    /** Channels of a site subtree; the BFF fetches series/statistics from analytics. */
    public List<ChannelResolver.Channel> resolveSiteChannels(UUID siteId) {
        objectRepository.findById(siteId)
            .orElseThrow(() -> new ResourceNotFoundException("Site", siteId));
        return channelResolver.resolveSite(siteId);
    }

    public int calculateBucketMinutes(Instant from, Instant to) {
        long spanMinutes = java.time.Duration.between(from, to).toMinutes();

        if (spanMinutes <= 360) return 1;
        if (spanMinutes <= 2 * 1440) return 5;
        if (spanMinutes <= 7 * 1440) return 15;
        if (spanMinutes <= 30 * 1440) return 60;
        if (spanMinutes <= 90 * 1440) return 360;
        return 1440;
    }

    @Transactional
    public List<AssetDTO> registerAssets(UUID siteId, List<DeviceRegistrationRequest> devices) {
        log.info("Registering {} assets to site: {}", devices.size(), siteId);

        ObjectEntity site = objectRepository.findById(siteId)
            .orElseThrow(() -> new ResourceNotFoundException("Site", siteId));

        if (devices == null || devices.isEmpty()) {
            throw new ValidationException("At least one device must be provided");
        }

        List<ObjectEntity> createdAssets = new ArrayList<>();

        try {
            for (DeviceRegistrationRequest device : devices) {
                if (device.deviceId() == null || device.deviceId().isBlank()) {
                    throw new ValidationException("Device ID must not be empty");
                }
                if (device.type() == null || device.type().isBlank()) {
                    throw new ValidationException("Device type must not be empty for device: " + device.deviceId());
                }
                if (device.name() == null || device.name().isBlank()) {
                    throw new ValidationException("Device name must not be empty for device: " + device.deviceId());
                }

                if (physicalDeviceRepository.existsByDeviceId(device.deviceId())) {
                    throw new DuplicateResourceException("Device already registered: " + device.deviceId());
                }

                String objectTypeName = OntologyService.assetTypeName(device.type());
                UUID tenantId = site.getTenant() != null ? site.getTenant().getId() : null;
                String properties = OntologyService.buildProperties("specs", "{}");
                UUID assetId = UUID.randomUUID();
                ObjectEntity saved = ontologyService.registerObject(assetId, objectTypeName, tenantId, device.name(), properties);
                ontologyService.upsertLink(saved.getId(), siteId, OntologyService.INSTALLED_AT);
                if (device.spaceId() != null) {
                    ontologyService.upsertLink(saved.getId(), device.spaceId(), OntologyService.INSTALLED_IN);
                }
                createdAssets.add(saved);
                log.info("Registered asset: {} to site: {}", saved.getDisplayName(), siteId);
            }
        } catch (DataAccessException e) {
            log.error("Database error registering assets to site {}: {}", siteId, e.getMessage(), e);
            throw new ServiceException("Failed to register assets", e);
        }

        log.info("Successfully registered {} assets to site: {}", createdAssets.size(), siteId);
        return createdAssets.stream().map(this::toDTO).toList();
    }

    public record DeviceRegistrationRequest(
        String deviceId,
        String protocol,
        String type,
        String name,
        String modelHuman,
        String signalMap,
        String secrets,
        UUID spaceId
    ) {}

    @Transactional
    public AssetDTO updateAsset(UUID assetId, String name, String type) {
        log.info("Updating asset: {} (name={})", assetId, name);

        ObjectEntity asset = objectRepository.findById(assetId)
            .orElseThrow(() -> new ResourceNotFoundException("Asset", assetId));

        boolean changed = false;

        if (name != null && !name.isBlank()) {
            asset.setDisplayName(name.trim());
            changed = true;
        }
        if (type != null && !type.isBlank()) {
            log.debug("Ignoring 'type' update for asset {} — type is managed via the ontology object type", assetId);
            changed = true;
        }

        if (!changed) {
            throw new ValidationException("At least one field (name, type) must be provided");
        }

        asset.setUpdatedAt(Instant.now());

        try {
            ObjectEntity saved = objectRepository.save(asset);
            log.info("Updated asset: {}", assetId);
            return toDTO(saved);
        } catch (DataAccessException e) {
            log.error("Database error updating asset {}: {}", assetId, e.getMessage(), e);
            throw new ServiceException("Failed to update asset", e);
        }
    }

    @Transactional
    public AssetDTO updateAssetSpace(UUID assetId, UUID spaceId) {
        log.info("Updating space for asset: {} to space: {}", assetId, spaceId);

        ObjectEntity asset = objectRepository.findById(assetId)
            .orElseThrow(() -> new ResourceNotFoundException("Asset", assetId));

        asset.setUpdatedAt(Instant.now());

        try {
            ObjectEntity saved = objectRepository.save(asset);
            ontologyService.deleteOutboundLinksOfType(assetId, OntologyService.INSTALLED_IN);
            if (spaceId != null) {
                ontologyService.upsertLink(assetId, spaceId, OntologyService.INSTALLED_IN);
            }
            log.info("Updated space for asset: {} to space: {}", assetId, spaceId);
            return toDTO(saved);
        } catch (DataAccessException e) {
            log.error("Database error updating space for asset {}: {}", assetId, e.getMessage(), e);
            throw new ServiceException("Failed to update asset space", e);
        }
    }

    @Transactional
    public AssetDTO relocateAsset(UUID assetId, UUID targetSiteId, UUID targetSpaceId) {
        log.info("Relocating asset: {} to site: {} space: {}", assetId, targetSiteId, targetSpaceId);

        if (targetSiteId == null) {
            throw new ValidationException("Target site ID must be provided");
        }

        ObjectEntity asset = objectRepository.findById(assetId)
            .orElseThrow(() -> new ResourceNotFoundException("Asset", assetId));

        objectRepository.findById(targetSiteId)
            .orElseThrow(() -> new ResourceNotFoundException("Target site", targetSiteId));

        if (targetSpaceId != null) {
            if (!objectRepository.existsById(targetSpaceId)) {
                throw new ResourceNotFoundException("Target space", targetSpaceId);
            }
            UUID spaceParentSite = resolveSpaceSiteId(targetSpaceId);
            if (spaceParentSite != null && !spaceParentSite.equals(targetSiteId)) {
                throw new ValidationException("Target space does not belong to the target site");
            }
        }

        UUID previousSiteId = ontologyService.resolveTargetId(assetId, OntologyService.INSTALLED_AT);
        boolean crossSiteMove = !targetSiteId.equals(previousSiteId);

        asset.setUpdatedAt(Instant.now());

        try {
            ObjectEntity saved = objectRepository.save(asset);
            ontologyService.deleteOutboundLinksOfType(assetId, OntologyService.INSTALLED_AT);
            ontologyService.upsertLink(assetId, targetSiteId, OntologyService.INSTALLED_AT);
            if (crossSiteMove || targetSpaceId != null) {
                ontologyService.deleteOutboundLinksOfType(assetId, OntologyService.INSTALLED_IN);
                if (targetSpaceId != null) {
                    ontologyService.upsertLink(assetId, targetSpaceId, OntologyService.INSTALLED_IN);
                }
            }
            UUID resolvedSpaceId = ontologyService.resolveTargetId(assetId, OntologyService.INSTALLED_IN);
            log.info("Relocated asset: {} from site: {} to site: {} (space: {})",
                assetId, previousSiteId, targetSiteId, resolvedSpaceId);
            return toDTO(saved);
        } catch (DataAccessException e) {
            log.error("Database error relocating asset {}: {}", assetId, e.getMessage(), e);
            throw new ServiceException("Failed to relocate asset", e);
        }
    }

    private UUID resolveSpaceSiteId(UUID spaceId) {
        UUID current = spaceId;
        for (int depth = 0; depth < 10; depth++) {
            UUID parent = ontologyService.resolveSourceId(current, OntologyService.CONTAINS);
            if (parent == null) return null;
            var parentObj = ontologyService.getObject(parent);
            if (OntologyService.BUILDING.equals(parentObj.getObjectType().getName())) {
                return parent;
            }
            current = parent;
        }
        return null;
    }

    private AssetDTO toDTO(ObjectEntity obj) {
        UUID siteId = ontologyService.resolveTargetId(obj.getId(), OntologyService.INSTALLED_AT);
        UUID spaceId = ontologyService.resolveTargetId(obj.getId(), OntologyService.INSTALLED_IN);
        String specs = OntologyService.extractProperty(obj.getProperties(), "specs");
        return new AssetDTO(
            obj.getId(),
            siteId,
            spaceId,
            obj.getDisplayName(),
            specs != null ? specs : "{}"
        );
    }
}
