package com.digitaldemon.core.anomalyrule;

import com.digitaldemon.core.anomalyrule.AnomalyRuleService.Binding;
import com.digitaldemon.core.common.exception.ResourceNotFoundException;
import com.digitaldemon.core.common.exception.ValidationException;
import com.digitaldemon.core.metricpoint.MetricPoint;
import com.digitaldemon.core.metricpoint.MetricPointService;
import com.digitaldemon.core.user.AuthService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * AnomalyRuleController — CRUD for user-configured anomaly rules plus the
 * template descriptors and the channel catalog the rule editor needs.
 *
 * Endpoints:
 *   GET    /api/v1/anomaly-rule-templates        — detector template descriptors
 *   GET    /api/v1/channels                      — tenant-wide channel catalog (for binding pickers)
 *   GET    /api/v1/anomaly-rules                 — all rules of the accessible tenants
 *   GET    /api/v1/objects/{objectId}/anomaly-rules — rules bound to any of the asset's metric points
 *   POST   /api/v1/anomaly-rules                 — create a rule
 *   PATCH  /api/v1/anomaly-rules/{ruleId}        — partial update
 *   DELETE /api/v1/anomaly-rules/{ruleId}        — delete a rule
 */
@Slf4j
@RestController
@RequiredArgsConstructor
public class AnomalyRuleController {

    private final AnomalyRuleService anomalyRuleService;
    private final MetricPointService metricPointService;
    private final AuthService authService;
    private final NamedParameterJdbcTemplate jdbc;

    // ── Templates ─────────────────────────────────────────────────────────

    @GetMapping("/api/v1/anomaly-rule-templates")
    public ResponseEntity<?> listTemplates() {
        List<Map<String, Object>> templates = AnomalyRuleTemplates.ALL.stream()
                .map(t -> Map.<String, Object>of(
                        "key", t.key(),
                        "label", t.label(),
                        "description", t.description(),
                        "dynamicRoles", t.dynamicRoles(),
                        "roles", t.roles().stream()
                                .map(r -> Map.of("role", r.role(), "required", r.required(), "label", r.label()))
                                .toList(),
                        "params", t.params().stream()
                                .map(p -> Map.of("key", p.key(), "defaultValue", p.defaultValue(), "label", p.label()))
                                .toList(),
                        "suppressRole", AnomalyRuleTemplates.SUPPRESS_ROLE))
                .toList();
        return ResponseEntity.ok(Map.of("templates", templates));
    }

    // ── Channel catalog ───────────────────────────────────────────────────

    /**
     * Tenant-wide list of channels for the binding pickers: every metric
     * point with its display name and the asset it belongs to (HAS_METRIC
     * parent). Prototype scale keeps this a plain list; a search parameter
     * can be added later without changing the contract.
     */
    @GetMapping("/api/v1/channels")
    public ResponseEntity<?> listChannels() {
        // getAccessibleTenantIds returns the empty list for SYSTEM_ADMIN,
        // meaning "all tenants" — not "none".
        List<UUID> tenantIds = authService.getAccessibleTenantIds();
        boolean allTenants = tenantIds.isEmpty() && authService.isSystemAdmin();
        if (tenantIds.isEmpty() && !allTenants) {
            return ResponseEntity.ok(Map.of("channels", List.of()));
        }
        List<Map<String, Object>> channels = jdbc.query("""
                SELECT mp.id, mp.device_id, mp.metric_id, mp.unit,
                       COALESCE(o.display_name, 'metric_' || mp.metric_id) AS metric_name,
                       asset.id AS asset_id,
                       asset.display_name AS asset_name
                FROM metric_points mp
                JOIN objects o ON o.id = mp.id
                LEFT JOIN links l ON l.target_object_id = mp.id
                     AND l.link_type_id = (SELECT id FROM link_types WHERE name = 'HAS_METRIC')
                LEFT JOIN objects asset ON asset.id = l.source_object_id
                WHERE (:allTenants OR o.tenant_id IN (:tenantIds))
                ORDER BY asset.display_name NULLS LAST, mp.metric_id
                """,
                Map.of("allTenants", allTenants,
                        "tenantIds", tenantIds.isEmpty() ? List.of(new UUID(0, 0)) : tenantIds),
                (rs, i) -> {
                    Map<String, Object> dto = new LinkedHashMap<>();
                    dto.put("metricPointId", rs.getString("id"));
                    dto.put("deviceId", rs.getString("device_id"));
                    dto.put("metricId", rs.getInt("metric_id"));
                    dto.put("unit", rs.getString("unit"));
                    dto.put("metricName", rs.getString("metric_name"));
                    dto.put("assetId", rs.getString("asset_id"));
                    dto.put("assetName", rs.getString("asset_name"));
                    return dto;
                });
        return ResponseEntity.ok(Map.of("channels", channels));
    }

    // ── List ──────────────────────────────────────────────────────────────

    @GetMapping("/api/v1/anomaly-rules")
    public ResponseEntity<?> listRules() {
        Set<UUID> tenantIds = Set.copyOf(authService.getAccessibleTenantIds());
        boolean allTenants = tenantIds.isEmpty() && authService.isSystemAdmin();
        List<Map<String, Object>> rules = anomalyRuleService.listAll().stream()
                .filter(rule -> allTenants || tenantIds.contains(rule.getTenantId()))
                .map(this::toDto)
                .toList();
        return ResponseEntity.ok(Map.of("rules", rules));
    }

    @GetMapping("/api/v1/objects/{objectId}/anomaly-rules")
    public ResponseEntity<?> listRulesForObject(@PathVariable String objectId) {
        UUID assetId = parseUUID(objectId, "object ID");

        List<UUID> tenantIds = authService.getAccessibleTenantIds();
        UUID tenantId = tenantIds.isEmpty() ? null : tenantIds.get(0);

        Set<UUID> metricPointIds = metricPointService.getForAsset(assetId, tenantId).stream()
                .map(MetricPoint::getId)
                .collect(Collectors.toSet());

        List<Map<String, Object>> rules = metricPointIds.isEmpty()
                ? List.of()
                : anomalyRuleService.listForMetricPoints(metricPointIds).stream()
                        .map(this::toDto)
                        .toList();
        return ResponseEntity.ok(Map.of("rules", rules));
    }

    // ── Create ────────────────────────────────────────────────────────────

    @PostMapping("/api/v1/anomaly-rules")
    public ResponseEntity<?> createRule(@RequestBody Map<String, Object> body) {
        log.info("POST /api/v1/anomaly-rules");
        String name = requireString(body, "name");
        String detector = requireString(body, "detector");
        Map<String, Object> params = paramsOf(body);
        List<Binding> bindings = bindingsOf(body);
        String severity = (String) body.getOrDefault("severity", "WARNING");
        int cooldownSeconds = body.get("cooldownSeconds") instanceof Number n ? n.intValue() : 1800;

        try {
            AnomalyRule rule = anomalyRuleService.createRule(
                    name, detector, params, bindings, severity, cooldownSeconds);
            return ResponseEntity.status(201).body(Map.of("rule", toDto(rule)));
        } catch (IllegalStateException e) {
            return ResponseEntity.badRequest().body(Map.of("message", e.getMessage()));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        }
    }

    // ── Update ────────────────────────────────────────────────────────────

    @PatchMapping("/api/v1/anomaly-rules/{ruleId}")
    public ResponseEntity<?> updateRule(@PathVariable String ruleId,
                                        @RequestBody Map<String, Object> body) {
        log.info("PATCH /api/v1/anomaly-rules/{}", ruleId);
        UUID id = parseUUID(ruleId, "rule ID");

        String name = body.containsKey("name") ? requireString(body, "name") : null;
        Map<String, Object> params = body.containsKey("params") ? paramsOf(body) : null;
        List<Binding> bindings = body.containsKey("bindings") ? bindingsOf(body) : null;
        String severity = body.containsKey("severity") ? (String) body.get("severity") : null;
        Integer cooldownSeconds = body.get("cooldownSeconds") instanceof Number n ? n.intValue() : null;
        Boolean enabled = body.containsKey("enabled") ? (Boolean) body.get("enabled") : null;

        try {
            AnomalyRule updated = anomalyRuleService.updateRule(
                    id, name, params, bindings, severity, cooldownSeconds, enabled);
            return ResponseEntity.ok(Map.of("rule", toDto(updated)));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        }
    }

    // ── Delete ────────────────────────────────────────────────────────────

    @DeleteMapping("/api/v1/anomaly-rules/{ruleId}")
    public ResponseEntity<?> deleteRule(@PathVariable String ruleId) {
        log.info("DELETE /api/v1/anomaly-rules/{}", ruleId);
        UUID id = parseUUID(ruleId, "rule ID");
        try {
            anomalyRuleService.deleteRule(id);
            return ResponseEntity.noContent().build();
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        }
    }

    // ── DTO / body parsing ────────────────────────────────────────────────

    private Map<String, Object> toDto(AnomalyRule rule) {
        Map<String, Object> dto = new LinkedHashMap<>();
        dto.put("id", rule.getId());
        dto.put("tenantId", rule.getTenantId());
        dto.put("name", rule.getName());
        dto.put("detector", rule.getDetector());
        dto.put("params", AnomalyRuleService.readParams(rule.getParams()));
        dto.put("bindings", AnomalyRuleService.parseBindings(rule.getBindings()).stream()
                .map(b -> Map.of("role", b.role(), "metricPointId", b.metricPointId().toString()))
                .toList());
        dto.put("severity", rule.getSeverity());
        dto.put("cooldownSeconds", rule.getCooldownSeconds());
        dto.put("enabled", rule.isEnabled());
        dto.put("createdAt", rule.getCreatedAt());
        dto.put("updatedAt", rule.getUpdatedAt());
        return dto;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> paramsOf(Map<String, Object> body) {
        Object params = body.getOrDefault("params", Map.of());
        if (!(params instanceof Map)) {
            throw new ValidationException("'params' must be an object");
        }
        return (Map<String, Object>) params;
    }

    private List<Binding> bindingsOf(Map<String, Object> body) {
        Object raw = body.get("bindings");
        if (!(raw instanceof List<?> list) || list.isEmpty()) {
            throw new ValidationException("'bindings' must be a non-empty list");
        }
        List<Binding> bindings = new ArrayList<>();
        for (Object item : list) {
            if (!(item instanceof Map<?, ?> map)) {
                throw new ValidationException("Every binding must be an object");
            }
            Object role = map.get("role");
            Object metricPointId = map.get("metricPointId");
            if (!(role instanceof String r) || r.isBlank() || !(metricPointId instanceof String mp)) {
                throw new ValidationException("Every binding needs 'role' and 'metricPointId'");
            }
            bindings.add(new Binding(r, parseUUID(mp, "metricPointId")));
        }
        return bindings;
    }

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
}
