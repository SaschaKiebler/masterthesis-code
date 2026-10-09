package com.heatingplatform.core.thresholdrule;

import com.heatingplatform.core.metricpoint.MetricPoint;
import com.heatingplatform.core.thresholdrule.ThresholdRule;
import com.heatingplatform.core.common.exception.ResourceNotFoundException;
import com.heatingplatform.core.common.exception.ValidationException;
import com.heatingplatform.core.user.AuthService;
import com.heatingplatform.core.metricpoint.MetricPointService;
import com.heatingplatform.core.ontology.OntologyService;
import com.heatingplatform.core.thresholdrule.ThresholdRuleService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * ThresholdRuleController — CRUD for per-metric-point alert rules.
 *
 * Endpoints:
 *   GET    /api/v1/metric-points/{id}/rules      — list rules for a metric point
 *   GET    /api/v1/objects/{objectId}/rules      — all rules for all metric points on a device (HAS_METRIC), enriched with display name
 *   POST   /api/v1/metric-points/{id}/rules      — create a rule
 *   PATCH  /api/v1/threshold-rules/{ruleId}      — update threshold / severity / cooldown / enabled
 *   DELETE /api/v1/threshold-rules/{ruleId}      — delete a rule
 */
@Slf4j
@RestController
@RequiredArgsConstructor
public class ThresholdRuleController {

    private static final Set<String> VALID_OPERATORS  = Set.of("GT", "LT", "GTE", "LTE", "CHANGED_TO_TRUE", "CHANGED_TO_FALSE");
    private static final Set<String> VALID_SEVERITIES = Set.of("INFO", "WARNING", "ERROR", "CRITICAL");

    private final ThresholdRuleService thresholdRuleService;
    private final MetricPointService metricPointService;
    private final OntologyService ontologyService;
    private final AuthService authService;

    // ── List ──────────────────────────────────────────────────────────────

    @GetMapping("/api/v1/metric-points/{id}/rules")
    public ResponseEntity<?> listRules(@PathVariable String id) {
        log.info("GET /api/v1/metric-points/{}/rules", id);
        UUID metricPointId = parseUUID(id, "metric point ID");

        List<Map<String, Object>> rules = thresholdRuleService
                .getRulesForMetricPoint(metricPointId)
                .stream()
                .map(this::toDto)
                .toList();

        return ResponseEntity.ok(Map.of("rules", rules));
    }

    /**
     * Aggregate endpoint: returns all threshold rules for every metric point linked to
     * a device object via HAS_METRIC, each rule enriched with its metric point's display name.
     * Replaces N individual calls to /metric-points/{id}/rules.
     */
    @GetMapping("/api/v1/objects/{objectId}/rules")
    public ResponseEntity<?> listRulesForDevice(@PathVariable String objectId) {
        log.info("GET /api/v1/objects/{}/rules", objectId);
        UUID assetId = parseUUID(objectId, "object ID");

        List<UUID> tenantIds = authService.getAccessibleTenantIds();
        UUID tenantId = tenantIds.isEmpty() ? null : tenantIds.get(0);

        List<MetricPoint> metricPoints = metricPointService.getForAsset(assetId, tenantId);

        List<Map<String, Object>> allRules = new ArrayList<>();
        for (MetricPoint mp : metricPoints) {
            String mpName;
            try {
                mpName = ontologyService.getObject(mp.getId()).getDisplayName();
            } catch (Exception e) {
                mpName = "metric_" + mp.getMetricId();
            }

            List<ThresholdRule> rules = thresholdRuleService.getRulesForMetricPoint(mp.getId());
            for (ThresholdRule rule : rules) {
                Map<String, Object> dto = toDto(rule);
                dto.put("metricPointName", mpName);
                allRules.add(dto);
            }
        }

        return ResponseEntity.ok(Map.of("rules", allRules));
    }

    // ── Create ────────────────────────────────────────────────────────────

    @PostMapping("/api/v1/metric-points/{id}/rules")
    public ResponseEntity<?> createRule(@PathVariable String id,
                                        @RequestBody Map<String, Object> body) {
        log.info("POST /api/v1/metric-points/{}/rules", id);
        UUID metricPointId = parseUUID(id, "metric point ID");

        String operator = requireString(body, "operator");
        if (!VALID_OPERATORS.contains(operator.toUpperCase())) {
            return ResponseEntity.badRequest()
                    .body(Map.of("message", "operator must be one of: GT, LT, GTE, LTE, CHANGED_TO_TRUE, CHANGED_TO_FALSE"));
        }

        // Threshold is required for numeric operators, ignored for state-change operators.
        boolean isStateChange = operator.toUpperCase().startsWith("CHANGED_TO");
        Double threshold = isStateChange
                ? null
                : requireDouble(body, "threshold");

        String severity = (String) body.getOrDefault("severity", "WARNING");
        if (!VALID_SEVERITIES.contains(severity.toUpperCase())) {
            return ResponseEntity.badRequest()
                    .body(Map.of("message", "severity must be one of: INFO, WARNING, ERROR, CRITICAL"));
        }

        int cooldownSeconds = body.get("cooldownSeconds") instanceof Number n ? n.intValue() : 300;

        try {
            ThresholdRule rule = thresholdRuleService.createRule(
                    metricPointId, operator, threshold, severity, cooldownSeconds);
            return ResponseEntity.status(201).body(Map.of("rule", toDto(rule)));
        } catch (IllegalStateException e) {
            return ResponseEntity.badRequest().body(Map.of("message", e.getMessage()));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        }
    }

    // ── Update ────────────────────────────────────────────────────────────

    @PatchMapping("/api/v1/threshold-rules/{ruleId}")
    public ResponseEntity<?> updateRule(@PathVariable String ruleId,
                                        @RequestBody Map<String, Object> body) {
        log.info("PATCH /api/v1/threshold-rules/{}", ruleId);
        UUID id = parseUUID(ruleId, "rule ID");

        String operator = body.containsKey("operator") ? requireString(body, "operator") : null;
        if (operator != null && !VALID_OPERATORS.contains(operator.toUpperCase())) {
            return ResponseEntity.badRequest()
                    .body(Map.of("message", "operator must be one of: GT, LT, GTE, LTE, CHANGED_TO_TRUE, CHANGED_TO_FALSE"));
        }

        Double threshold = body.get("threshold") instanceof Number n ? n.doubleValue() : null;

        String severity = body.containsKey("severity") ? (String) body.get("severity") : null;
        if (severity != null && !VALID_SEVERITIES.contains(severity.toUpperCase())) {
            return ResponseEntity.badRequest()
                    .body(Map.of("message", "severity must be one of: INFO, WARNING, ERROR, CRITICAL"));
        }

        Integer cooldownSeconds = body.get("cooldownSeconds") instanceof Number n ? n.intValue() : null;
        Boolean enabled = body.containsKey("enabled") ? (Boolean) body.get("enabled") : null;

        try {
            ThresholdRule updated = thresholdRuleService.updateRule(
                    id, threshold, operator, severity, cooldownSeconds, enabled);
            return ResponseEntity.ok(Map.of("rule", toDto(updated)));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        }
    }

    // ── Delete ────────────────────────────────────────────────────────────

    @DeleteMapping("/api/v1/threshold-rules/{ruleId}")
    public ResponseEntity<?> deleteRule(@PathVariable String ruleId) {
        log.info("DELETE /api/v1/threshold-rules/{}", ruleId);
        UUID id = parseUUID(ruleId, "rule ID");

        try {
            thresholdRuleService.deleteRule(id);
            return ResponseEntity.noContent().build();
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        }
    }

    // ── DTO ───────────────────────────────────────────────────────────────

    private Map<String, Object> toDto(ThresholdRule rule) {
        Map<String, Object> dto = new LinkedHashMap<>();
        dto.put("id",              rule.getId());
        dto.put("metricPointId",   rule.getMetricPointId());
        dto.put("operator",        rule.getOperator());
        dto.put("threshold",       rule.getThreshold());
        dto.put("severity",        rule.getSeverity());
        dto.put("cooldownSeconds", rule.getCooldownSeconds());
        dto.put("enabled",         rule.isEnabled());
        dto.put("tenantId",        rule.getTenantId());
        dto.put("createdAt",       rule.getCreatedAt());
        dto.put("updatedAt",       rule.getUpdatedAt());
        return dto;
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    private UUID parseUUID(String value, String fieldName) {
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException e) {
            throw new ValidationException("Invalid " + fieldName + ": " + value);
        }
    }

    private String requireString(Map<String, Object> body, String key) {
        Object val = body.get(key);
        if (!(val instanceof String s) || s.isBlank()) {
            throw new ValidationException("'" + key + "' is required");
        }
        return s;
    }

    private Double requireDouble(Map<String, Object> body, String key) {
        Object val = body.get(key);
        if (val instanceof Number n) return n.doubleValue();
        throw new ValidationException("'" + key + "' must be a number");
    }
}
