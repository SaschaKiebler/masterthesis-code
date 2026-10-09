package com.heatingplatform.core.metricpoint;

import com.heatingplatform.core.tenancy.TenantBodyGuard;
import com.heatingplatform.core.tenancy.ResourceKind;
import com.heatingplatform.core.ontology.ObjectEntity;
import com.heatingplatform.core.metricpoint.MetricPoint;
import com.heatingplatform.core.physicalquantity.PhysicalQuantity;
import com.heatingplatform.core.common.exception.ResourceNotFoundException;
import com.heatingplatform.core.user.AuthService;
import com.heatingplatform.core.metricpoint.MetricPointService;
import com.heatingplatform.core.ontology.OntologyService;
import com.heatingplatform.core.physicalquantity.PhysicalQuantityService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * MetricPointController — REST API for metric point management (ADR-013).
 *
 * Endpoints:
 *   GET    /api/v1/objects/{objectId}/metrics        — list metric points for an asset
 *   POST   /api/v1/objects/{objectId}/metrics        — create metric point
 *   GET    /api/v1/metric-points/{id}                — get metric point detail
 *   PATCH  /api/v1/metric-points/{id}                — update metric point
 *   DELETE /api/v1/metric-points/{id}                — delete metric point
 *   GET    /api/v1/metric-points/{id}/measurements   — measurements for a single metric point
 */
@Slf4j
@RestController
@RequiredArgsConstructor
public class MetricPointController {

    private final MetricPointService metricPointService;
    private final PhysicalQuantityService physicalQuantityService;
    private final OntologyService ontologyService;
    private final AuthService authService;
    private final TenantBodyGuard tenantBodyGuard;

    @GetMapping("/api/v1/objects/{objectId}/metrics")
    public ResponseEntity<?> listMetricPoints(@PathVariable String objectId) {
        log.info("GET /api/v1/objects/{}/metrics", objectId);
        UUID assetId = parseUUID(objectId, "object ID");
        List<UUID> tenantIds = authService.getAccessibleTenantIds();
        UUID tenantId = tenantIds.isEmpty() ? null : tenantIds.get(0);

        List<MetricPoint> metricPoints = metricPointService.getForAsset(assetId, tenantId);
        List<Map<String, Object>> dtos = metricPoints.stream().map(mp -> toDto(mp)).toList();
        return ResponseEntity.ok(Map.of("metricPoints", dtos));
    }

    @PostMapping("/api/v1/objects/{objectId}/metrics")
    public ResponseEntity<?> createMetricPoint(@PathVariable String objectId,
                                               @RequestBody Map<String, Object> body) {
        log.info("POST /api/v1/objects/{}/metrics", objectId);
        UUID assetId = parseUUID(objectId, "object ID");
        String tenantIdStr = (String) body.get("tenantId");
        UUID tenantId = tenantIdStr != null ? parseUUID(tenantIdStr, "tenantId") : null;

        String deviceId = (String) body.get("deviceId");
        Integer metricIdInt = body.get("metricId") instanceof Number n ? n.intValue() : null;
        String quantityName = (String) body.get("quantityName");
        String unit = (String) body.get("unit");
        String source = (String) body.get("source");
        String field = (String) body.get("field");
        Double minValue = body.get("minValue") instanceof Number n ? n.doubleValue() : null;
        Double maxValue = body.get("maxValue") instanceof Number n ? n.doubleValue() : null;
        Integer sampleInterval = body.get("sampleIntervalSeconds") instanceof Number n ? n.intValue() : null;

        if (deviceId == null || deviceId.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("message", "deviceId is required"));
        }
        if (metricIdInt == null) {
            return ResponseEntity.badRequest().body(Map.of("message", "metricId is required"));
        }
        if (unit == null || unit.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("message", "unit is required"));
        }

        // The tenant is the anchor object's; a body tenantId may only confirm it.
        // And the device id, a plain string, must not already be another
        // tenant's device, or the new metric point would read its live values.
        tenantBodyGuard.requireTenant(tenantId);
        tenantBodyGuard.requireDeviceNotForeign(deviceId);
        ObjectEntity anchor = ontologyService.getObject(assetId);
        UUID anchorTenant = anchor.getTenant() == null ? null : anchor.getTenant().getId();
        if (tenantId != null && !tenantId.equals(anchorTenant)) {
            return ResponseEntity.badRequest()
                .body(Map.of("message", "tenantId does not match the object's tenant"));
        }
        tenantId = anchorTenant;

        MetricPoint created = metricPointService.createMetricPoint(
            assetId, deviceId, metricIdInt.shortValue(), quantityName, unit,
            source, field, minValue, maxValue, sampleInterval, tenantId);

        return ResponseEntity.status(201).body(Map.of("metricPoint", toDto(created)));
    }

    @GetMapping("/api/v1/metric-points/{id}")
    public ResponseEntity<?> getMetricPoint(@PathVariable String id) {
        log.info("GET /api/v1/metric-points/{}", id);
        UUID metricPointId = parseUUID(id, "metric point ID");

        Optional<MetricPoint> opt = metricPointService.findById(metricPointId);
        if (opt.isEmpty()) {
            return ResponseEntity.status(404).body(Map.of("message", "MetricPoint not found"));
        }
        return ResponseEntity.ok(Map.of("metricPoint", toDto(opt.get())));
    }

    @PatchMapping("/api/v1/metric-points/{id}")
    public ResponseEntity<?> updateMetricPoint(@PathVariable String id,
                                               @RequestBody Map<String, Object> body) {
        log.info("PATCH /api/v1/metric-points/{}", id);
        UUID metricPointId = parseUUID(id, "metric point ID");
        UUID tenantId = null;

        String unit = (String) body.get("unit");
        Double minValue = body.get("minValue") instanceof Number n ? n.doubleValue() : null;
        Double maxValue = body.get("maxValue") instanceof Number n ? n.doubleValue() : null;
        Integer sampleInterval = body.get("sampleIntervalSeconds") instanceof Number n ? n.intValue() : null;
        String quantityName = (String) body.get("quantityName");

        try {
            MetricPoint updated = metricPointService.updateMetricPoint(
                metricPointId, unit, minValue, maxValue, sampleInterval, quantityName, tenantId);
            return ResponseEntity.ok(Map.of("metricPoint", toDto(updated)));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        }
    }

    @DeleteMapping("/api/v1/metric-points/{id}")
    public ResponseEntity<?> deleteMetricPoint(@PathVariable String id) {
        log.info("DELETE /api/v1/metric-points/{}", id);
        UUID metricPointId = parseUUID(id, "metric point ID");

        try {
            metricPointService.deleteMetricPoint(metricPointId);
            return ResponseEntity.noContent().build();
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        }
    }

    // Measurement series for a metric point are served by the analytics
    // service; the BFF composes them from GET /metric-points/{id} (channel)
    // plus POST /stats/series (resolve-then-fetch, design doc §6).

    private Map<String, Object> toDto(MetricPoint mp) {
        Map<String, Object> dto = new LinkedHashMap<>();
        dto.put("id", mp.getId());
        dto.put("deviceId", mp.getDeviceId());
        dto.put("metricId", mp.getMetricId());
        dto.put("source", mp.getSource());
        dto.put("field", mp.getField());
        dto.put("quantityId", mp.getQuantityId());
        dto.put("unit", mp.getUnit());
        dto.put("minValue", mp.getMinValue());
        dto.put("maxValue", mp.getMaxValue());
        dto.put("precisionDigits", mp.getPrecisionDigits());
        dto.put("sampleIntervalSeconds", mp.getSampleIntervalSeconds());
        // Include the original signal map entry name (e.g. "phase_a_active_power") stored
        // in objects.display_name so the frontend can show descriptive per-phase labels.
        try {
            dto.put("displayName", ontologyService.getObject(mp.getId()).getDisplayName());
        } catch (Exception ignored) {}
        // Enrich with quantity display name if available
        if (mp.getQuantityId() != null) {
            physicalQuantityService.findById(mp.getQuantityId()).ifPresent(pq -> {
                dto.put("quantityName", pq.getName());
                dto.put("quantityDisplayName", pq.getDisplayName());
                dto.put("dimension", pq.getDimension());
                dto.put("defaultUnit", pq.getDefaultUnit());
            });
        }
        return dto;
    }

    private UUID parseUUID(String value, String fieldName) {
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException e) {
            throw new com.heatingplatform.core.common.exception.ValidationException("Invalid " + fieldName + ": " + value);
        }
    }

    private Instant parseInstant(String value) {
        try {
            long epoch = Long.parseLong(value);
            return Instant.ofEpochSecond(epoch);
        } catch (NumberFormatException e) {
            return Instant.parse(value);
        }
    }
}
