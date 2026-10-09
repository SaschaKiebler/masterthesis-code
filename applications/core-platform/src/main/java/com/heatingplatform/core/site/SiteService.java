package com.heatingplatform.core.site;

import com.heatingplatform.core.ontology.OntologyService;

import com.heatingplatform.core.site.SiteDTO;
import com.heatingplatform.core.ontology.ObjectEntity;
import com.heatingplatform.core.tenant.Tenant;
import com.heatingplatform.core.common.exception.DuplicateResourceException;
import com.heatingplatform.core.common.exception.ResourceNotFoundException;
import com.heatingplatform.core.common.exception.ServiceException;
import com.heatingplatform.core.common.exception.ValidationException;
import com.heatingplatform.core.ontology.ObjectRepository;
import com.heatingplatform.core.tenant.TenantRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Slf4j
@Transactional(readOnly = true)
public class SiteService {

    private final ObjectRepository objectRepository;
    private final TenantRepository tenantRepository;
    private final OntologyService ontologyService;

    /**
     * Get all sites (BUILDING objects).
     */
    public List<SiteDTO> getAllSites() {
        return objectRepository.findByObjectTypeName(OntologyService.BUILDING).stream()
            .map(this::toDTO)
            .toList();
    }

    /**
     * Get sites for a specific tenant.
     */
    public List<SiteDTO> getSitesByTenant(UUID tenantId) {
        return objectRepository.findByTenantIdAndObjectTypeName(tenantId, OntologyService.BUILDING).stream()
            .map(this::toDTO)
            .toList();
    }

    /**
     * Get sites by explicit site IDs (for technicians with site assignments).
     */
    public List<SiteDTO> getSitesBySiteIds(List<UUID> siteIds) {
        if (siteIds == null || siteIds.isEmpty()) return List.of();
        return objectRepository.findByIdInAndObjectTypeName(siteIds, OntologyService.BUILDING).stream()
            .map(this::toDTO)
            .toList();
    }

    /**
     * Get a single site by ID.
     */
    public Optional<ObjectEntity> getSiteById(UUID id) {
        log.debug("Fetching site: {}", id);
        return objectRepository.findById(id);
    }

    /**
     * Create a new site (BUILDING object).
     *
     * @param tenantId  Tenant UUID (must exist)
     * @param name      Site name (must be unique)
     * @param address   Address as JSON string
     * @param metadata  Optional metadata as JSON string
     * @return the created ObjectEntity
     */
    @Transactional
    public ObjectEntity createSite(UUID tenantId, String name, String address, String metadata) {
        log.info("Creating site: {} for tenant: {}", name, tenantId);

        if (name == null || name.isBlank()) {
            throw new ValidationException("Site name must not be empty");
        }
        if (address == null || address.isBlank()) {
            throw new ValidationException("Site address must not be empty");
        }

        Tenant tenant = tenantRepository.findById(tenantId)
            .orElseThrow(() -> new ResourceNotFoundException("Tenant", tenantId));

        if (objectRepository.findByDisplayName(name).isPresent()) {
            throw new DuplicateResourceException("Site already exists: " + name);
        }

        try {
            String addressJson = toJsonAddress(address);
            String properties = OntologyService.mergeProperty("{}", "address", addressJson);
            if (metadata != null && !metadata.isBlank()) {
                properties = OntologyService.mergeProperty(properties, "attributes", metadata);
            }

            UUID id = UUID.randomUUID();
            ObjectEntity saved = ontologyService.registerObject(id, OntologyService.BUILDING, tenantId, name, properties);
            log.info("Created site: {} (id: {})", name, saved.getId());
            return saved;
        } catch (DataAccessException e) {
            log.error("Database error creating site {}: {}", name, e.getMessage(), e);
            throw new ServiceException("Failed to create site", e);
        }
    }

    /**
     * Ensures address is valid JSON for the properties JSONB column.
     */
    private String toJsonAddress(String address) {
        if (address == null || address.isBlank()) {
            return "{}";
        }
        String trimmed = address.trim();
        if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
            return trimmed;
        }
        String escaped = trimmed.replace("\\", "\\\\").replace("\"", "\\\"");
        return "{\"display\": \"" + escaped + "\"}";
    }

    private SiteDTO toDTO(ObjectEntity obj) {
        int assetCount = ontologyService.countByTargetAndType(obj.getId(), OntologyService.INSTALLED_AT);
        String address = OntologyService.extractProperty(obj.getProperties(), "address");
        return new SiteDTO(
            obj.getId(),
            obj.getDisplayName(),
            address != null ? address : "",
            assetCount
        );
    }
}
