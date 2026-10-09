package com.heatingplatform.core.physicalquantity;

import com.heatingplatform.core.ontology.OntologyService;

import com.heatingplatform.core.physicalquantity.PhysicalQuantity;
import com.heatingplatform.core.common.exception.ResourceNotFoundException;
import com.heatingplatform.core.physicalquantity.PhysicalQuantityRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Slf4j
@Transactional(readOnly = true)
public class PhysicalQuantityService {

    private final PhysicalQuantityRepository physicalQuantityRepository;
    private final OntologyService ontologyService;

    public List<PhysicalQuantity> listAll() {
        return physicalQuantityRepository.findAll();
    }

    public List<PhysicalQuantity> listByDimension(String dimension) {
        return physicalQuantityRepository.findByDimension(dimension);
    }

    public List<PhysicalQuantity> listByDomain(String domain) {
        return physicalQuantityRepository.findByDomain(domain);
    }

    public Optional<PhysicalQuantity> findById(UUID id) {
        return physicalQuantityRepository.findById(id);
    }

    public Optional<PhysicalQuantity> findByName(String name) {
        return physicalQuantityRepository.findByName(name);
    }

    /**
     * Resolve a physical quantity by exact name, then by fuzzy lowercase match.
     * Used during signal_map migration to match 'total_current' → 'current', etc.
     */
    public Optional<PhysicalQuantity> resolveByName(String rawName) {
        if (rawName == null || rawName.isBlank()) return Optional.empty();

        // Exact match first
        Optional<PhysicalQuantity> exact = physicalQuantityRepository.findByName(rawName.toLowerCase().strip());
        if (exact.isPresent()) return exact;

        // Fuzzy: normalize underscores, try contains match across all quantities
        String normalized = rawName.toLowerCase().strip().replace("-", "_").replace(" ", "_");
        return physicalQuantityRepository.findAll().stream()
            .filter(pq -> pq.getName().contains(normalized) || normalized.contains(pq.getName()))
            .findFirst();
    }

    /**
     * Create a new custom physical quantity for a tenant.
     * Also registers it in the objects table.
     */
    @Transactional
    public PhysicalQuantity createQuantity(String name, String displayName, String description,
                                           String dimension, String defaultUnit, String aggregation,
                                           String domain, UUID tenantId) {
        UUID id = UUID.randomUUID();

        ontologyService.registerObject(id, OntologyService.PHYSICAL_QUANTITY, tenantId, displayName);

        PhysicalQuantity pq = new PhysicalQuantity();
        pq.setId(id);
        pq.setName(name);
        pq.setDisplayName(displayName);
        pq.setDescription(description);
        pq.setDimension(dimension);
        pq.setDefaultUnit(defaultUnit);
        pq.setAggregation(aggregation != null ? aggregation : "MEAN");
        pq.setDomain(domain != null ? domain : "HVAC");
        pq.setCreatedAt(Instant.now());

        PhysicalQuantity saved = physicalQuantityRepository.save(pq);
        log.info("Created physical quantity: {} ({})", name, id);
        return saved;
    }
}
