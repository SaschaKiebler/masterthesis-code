package com.digitaldemon.core.physicalquantity;

import com.digitaldemon.core.physicalquantity.PhysicalQuantity;
import com.digitaldemon.core.common.exception.ResourceNotFoundException;
import com.digitaldemon.core.user.AuthService;
import com.digitaldemon.core.physicalquantity.PhysicalQuantityService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * PhysicalQuantityController — REST API for the physical quantity catalog (ADR-013).
 *
 * Endpoints:
 *   GET  /api/v1/physical-quantities          — list all (filterable by dimension, domain)
 *   POST /api/v1/physical-quantities          — create custom quantity
 *   GET  /api/v1/physical-quantities/{id}     — get detail
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/physical-quantities")
@RequiredArgsConstructor
public class PhysicalQuantityController {

    private final PhysicalQuantityService physicalQuantityService;
    private final AuthService authService;

    @GetMapping
    public ResponseEntity<?> listQuantities(@RequestParam(required = false) String dimension,
                                             @RequestParam(required = false) String domain) {
        log.info("GET /api/v1/physical-quantities (dimension={}, domain={})", dimension, domain);

        List<PhysicalQuantity> quantities;
        if (dimension != null && domain != null) {
            quantities = physicalQuantityService.listByDimension(dimension).stream()
                .filter(pq -> domain.equalsIgnoreCase(pq.getDomain()))
                .toList();
        } else if (dimension != null) {
            quantities = physicalQuantityService.listByDimension(dimension);
        } else if (domain != null) {
            quantities = physicalQuantityService.listByDomain(domain);
        } else {
            quantities = physicalQuantityService.listAll();
        }

        List<Map<String, Object>> dtos = quantities.stream().map(this::toDto).toList();
        return ResponseEntity.ok(Map.of("quantities", dtos));
    }

    @GetMapping("/{id}")
    public ResponseEntity<?> getQuantity(@PathVariable String id) {
        log.info("GET /api/v1/physical-quantities/{}", id);
        UUID quantityId = parseUUID(id, "quantity ID");

        Optional<PhysicalQuantity> opt = physicalQuantityService.findById(quantityId);
        if (opt.isEmpty()) {
            return ResponseEntity.status(404).body(Map.of("message", "PhysicalQuantity not found"));
        }
        return ResponseEntity.ok(Map.of("quantity", toDto(opt.get())));
    }

    @PostMapping
    public ResponseEntity<?> createQuantity(@RequestBody Map<String, Object> body) {
        log.info("POST /api/v1/physical-quantities");
        String tenantIdStr = (String) body.get("tenantId");
        UUID tenantId = tenantIdStr != null ? parseUUID(tenantIdStr, "tenantId") : null;

        String name = (String) body.get("name");
        String displayName = (String) body.get("displayName");
        String description = (String) body.get("description");
        String dimension = (String) body.get("dimension");
        String defaultUnit = (String) body.get("defaultUnit");
        String aggregation = (String) body.get("aggregation");
        String domain = (String) body.get("domain");

        if (name == null || name.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("message", "name is required"));
        }
        if (dimension == null || dimension.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("message", "dimension is required"));
        }
        if (defaultUnit == null || defaultUnit.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("message", "defaultUnit is required"));
        }

        PhysicalQuantity created = physicalQuantityService.createQuantity(
            name, displayName != null ? displayName : name,
            description, dimension, defaultUnit, aggregation, domain, tenantId);

        return ResponseEntity.status(201).body(Map.of("quantity", toDto(created)));
    }

    private Map<String, Object> toDto(PhysicalQuantity pq) {
        return Map.of(
            "id", pq.getId(),
            "name", pq.getName(),
            "displayName", pq.getDisplayName(),
            "description", pq.getDescription() != null ? pq.getDescription() : "",
            "dimension", pq.getDimension(),
            "defaultUnit", pq.getDefaultUnit(),
            "aggregation", pq.getAggregation(),
            "domain", pq.getDomain() != null ? pq.getDomain() : "HVAC"
        );
    }

    private UUID parseUUID(String value, String fieldName) {
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException e) {
            throw new com.digitaldemon.core.common.exception.ValidationException("Invalid " + fieldName + ": " + value);
        }
    }
}
