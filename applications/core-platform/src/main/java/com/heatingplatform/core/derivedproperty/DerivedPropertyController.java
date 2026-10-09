package com.heatingplatform.core.derivedproperty;

import com.heatingplatform.core.tenancy.TenantBodyGuard;
import com.heatingplatform.core.tenancy.ResourceKind;
import com.heatingplatform.core.derivedproperty.DerivedProperty;
import com.heatingplatform.core.user.AuthService;
import com.heatingplatform.core.derivedproperty.DerivedPropertyService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * DerivedPropertyController — REST API for ML/pipeline derived properties (ADR-013).
 *
 * Endpoints:
 *   GET  /api/v1/objects/{objectId}/derived-properties   — current derived properties for an object
 *   GET  /api/v1/derived-properties                      — query across objects (by property_name, object_type)
 *   POST /api/v1/derived-properties                      — write derived property (for pipelines/models)
 */
@Slf4j
@RestController
@RequiredArgsConstructor
public class DerivedPropertyController {

    private final DerivedPropertyService derivedPropertyService;
    private final AuthService authService;
    private final TenantBodyGuard tenantBodyGuard;

    @GetMapping("/api/v1/objects/{objectId}/derived-properties")
    public ResponseEntity<?> getObjectDerivedProperties(@PathVariable String objectId) {
        log.info("GET /api/v1/objects/{}/derived-properties", objectId);
        UUID objId = parseUUID(objectId, "object ID");

        List<DerivedProperty> props = derivedPropertyService.getCurrentProperties(objId);
        List<Map<String, Object>> dtos = props.stream().map(this::toDto).toList();
        return ResponseEntity.ok(Map.of("derivedProperties", dtos));
    }

    @GetMapping("/api/v1/derived-properties")
    public ResponseEntity<?> queryDerivedProperties(
            @RequestParam(required = false) String propertyName,
            @RequestParam(required = false) String objectTypes) {
        log.info("GET /api/v1/derived-properties (property={}, objectTypes={})", propertyName, objectTypes);
        List<UUID> tenantIds = authService.getAccessibleTenantIds();
        UUID tenantId = tenantIds.isEmpty() ? null : tenantIds.get(0);

        List<DerivedProperty> props;
        if (propertyName != null && objectTypes != null) {
            List<String> types = Arrays.asList(objectTypes.split(","));
            props = derivedPropertyService.getByPropertyAndObjectTypes(propertyName, types, tenantId);
        } else {
            props = derivedPropertyService.getAllCurrentByTenant(tenantId);
        }

        List<Map<String, Object>> dtos = props.stream().map(this::toDto).toList();
        return ResponseEntity.ok(Map.of("derivedProperties", dtos));
    }

    @PostMapping("/api/v1/derived-properties")
    public ResponseEntity<?> writeDerivedProperty(@RequestBody Map<String, Object> body) {
        log.info("POST /api/v1/derived-properties");
        List<UUID> tenantIds = authService.getAccessibleTenantIds();
        UUID tenantId = tenantIds.isEmpty() ? null : tenantIds.get(0);

        String objectIdStr = (String) body.get("objectId");
        String propertyName = (String) body.get("propertyName");
        String displayName = (String) body.get("displayName");
        Double valueNumeric = body.get("valueNumeric") instanceof Number n ? n.doubleValue() : null;
        String valueText = (String) body.get("valueText");
        String unit = (String) body.get("unit");
        Double confidence = body.get("confidence") instanceof Number n ? n.doubleValue() : null;
        String quality = (String) body.getOrDefault("quality", "GOOD");
        String sourceType = (String) body.getOrDefault("sourceType", "PIPELINE");
        String sourceId = (String) body.get("sourceId");
        String sourceVersion = (String) body.get("sourceVersion");

        if (objectIdStr == null) {
            return ResponseEntity.badRequest().body(Map.of("message", "objectId is required"));
        }
        if (propertyName == null || propertyName.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("message", "propertyName is required"));
        }

        UUID objectId = parseUUID(objectIdStr, "objectId");
        // Writing expires the object's current value of this property, so a
        // foreign object id would let the caller overwrite another tenant's data.
        tenantBodyGuard.requireAccess(ResourceKind.OBJECT, objectId);

        DerivedProperty saved = derivedPropertyService.writeProperty(
            objectId, propertyName, displayName, valueNumeric, valueText,
            unit, confidence, quality, sourceType, sourceId, sourceVersion, tenantId);

        return ResponseEntity.status(201).body(Map.of("derivedProperty", toDto(saved)));
    }

    private Map<String, Object> toDto(DerivedProperty dp) {
        Map<String, Object> dto = new LinkedHashMap<>();
        dto.put("id", dp.getId());
        dto.put("objectId", dp.getObjectId());
        dto.put("propertyName", dp.getPropertyName());
        dto.put("displayName", dp.getDisplayName());
        dto.put("valueNumeric", dp.getValueNumeric());
        dto.put("valueText", dp.getValueText());
        dto.put("unit", dp.getUnit());
        dto.put("confidence", dp.getConfidence());
        dto.put("quality", dp.getQuality());
        dto.put("sourceType", dp.getSourceType());
        dto.put("sourceId", dp.getSourceId());
        dto.put("sourceVersion", dp.getSourceVersion());
        dto.put("computedAt", dp.getComputedAt());
        dto.put("validFrom", dp.getValidFrom());
        dto.put("validUntil", dp.getValidUntil());
        return dto;
    }

    private UUID parseUUID(String value, String fieldName) {
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException e) {
            throw new com.heatingplatform.core.common.exception.ValidationException("Invalid " + fieldName + ": " + value);
        }
    }
}
