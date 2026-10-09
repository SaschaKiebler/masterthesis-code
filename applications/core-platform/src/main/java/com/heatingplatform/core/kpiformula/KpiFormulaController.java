package com.heatingplatform.core.kpiformula;

import java.util.ArrayList;
import com.heatingplatform.core.tenancy.TenantBodyGuard;
import com.heatingplatform.core.tenancy.ResourceKind;
import com.heatingplatform.core.derivedproperty.DerivedProperty;
import com.heatingplatform.core.kpiformula.KpiFormula;
import com.heatingplatform.core.ontology.ObjectEntity;
import com.heatingplatform.core.common.exception.ResourceNotFoundException;
import com.heatingplatform.core.common.exception.ValidationException;
import com.heatingplatform.core.derivedproperty.DerivedPropertyService;
import com.heatingplatform.core.kpiformula.KpiFormulaGenerationService;
import com.heatingplatform.core.kpiformula.KpiFormulaService;
import com.heatingplatform.core.ontology.OntologyService;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * KpiFormulaController — REST API for managing and evaluating user-defined KPI formulas.
 *
 * All formula operations are scoped to an ontology object (the anchor), so the URL structure
 * nests formula creation and listing under {@code /api/v1/objects/{objectId}/kpi-formulas}.
 * Update, delete, and evaluate operations use the formula's own ID.
 *
 * Endpoints:
 * <pre>
 *   GET    /api/v1/objects/{objectId}/kpi-formulas      — list formulas for an object
 *   POST   /api/v1/objects/{objectId}/kpi-formulas      — create formula
 *   PATCH  /api/v1/kpi-formulas/{id}                    — update formula fields
 *   DELETE /api/v1/kpi-formulas/{id}                    — delete formula
 *   POST   /api/v1/kpi-formulas/{id}/evaluate           — manual evaluate and persist
 * </pre>
 */
@Slf4j
@RestController
@RequiredArgsConstructor
public class KpiFormulaController {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final KpiFormulaService kpiFormulaService;
    private final DerivedPropertyService derivedPropertyService;
    private final OntologyService ontologyService;
    private final KpiFormulaGenerationService kpiFormulaGenerationService;
    private final TenantBodyGuard tenantBodyGuard;

    // ── List ──────────────────────────────────────────────────────────────────

    /**
     * List all KPI formulas attached to an ontology object.
     */
    @GetMapping("/api/v1/objects/{objectId}/kpi-formulas")
    public ResponseEntity<?> listFormulas(@PathVariable String objectId) {
        log.info("GET /api/v1/objects/{}/kpi-formulas", objectId);
        UUID id = parseUUID(objectId, "object ID");

        List<Map<String, Object>> formulas = kpiFormulaService.getFormulasForObject(id)
                .stream()
                .map(this::toDto)
                .toList();

        return ResponseEntity.ok(Map.of("formulas", formulas));
    }

    // ── Create ────────────────────────────────────────────────────────────────

    /**
     * Create a new KPI formula attached to an ontology object.
     *
     * Request body:
     * <pre>
     * {
     *   "name":        "cop",                     // required: machine key
     *   "displayName": "Coefficient of Performance", // optional (defaults to name)
     *   "formula":     "thermal_out / elec_in",   // required: exp4j expression
     *   "variables": {                             // optional: variable bindings map
     *     "thermal_out": { "mode": "DIRECT", "metricPointId": "uuid" },
     *     "elec_in":     { "mode": "TRAVERSE", "linkTypeName": "FEEDS",
     *                      "quantityName": "power", "direction": "OUTBOUND", "aggregation": "SUM" }
     *   },
     *   "unit": "dimensionless"                   // optional
     * }
     * </pre>
     */
    @PostMapping("/api/v1/objects/{objectId}/kpi-formulas")
    public ResponseEntity<?> createFormula(@PathVariable String objectId,
                                            @RequestBody Map<String, Object> body) {
        log.info("POST /api/v1/objects/{}/kpi-formulas", objectId);
        UUID objId = parseUUID(objectId, "object ID");

        String name        = requireString(body, "name");
        String displayName = (String) body.getOrDefault("displayName", name);
        String formula     = requireString(body, "formula");
        String variables   = extractVariablesJson(body);
        String unit        = (String) body.get("unit");
        // Variables bind metric points by id from the body; a foreign one would
        // read the other tenant's live value into the caller's formula.
        tenantBodyGuard.requireReferenceToAll(ResourceKind.OBJECT, metricPointIdsOf(variables));

        // Derive tenantId from the anchor object — more reliable than the auth security context
        // and ensures the formula's tenant always matches the object it belongs to.
        ObjectEntity anchor;
        try {
            anchor = ontologyService.getObject(objId);
        } catch (Exception e) {
            return ResponseEntity.status(404)
                    .body(Map.of("message", "Object not found: " + objId));
        }
        if (anchor.getTenant() == null) {
            return ResponseEntity.badRequest()
                    .body(Map.of("message", "Object has no tenant assigned"));
        }
        UUID tenantId = anchor.getTenant().getId();

        try {
            KpiFormula created = kpiFormulaService.createFormula(
                    objId, name, displayName, formula, variables, unit, tenantId);
            return ResponseEntity.status(201).body(Map.of("formula", toDto(created)));
        } catch (ValidationException e) {
            return ResponseEntity.badRequest().body(Map.of("message", e.getMessage()));
        } catch (Exception e) {
            log.error("Error creating KPI formula for object {}", objId, e);
            return ResponseEntity.internalServerError()
                    .body(Map.of("message", e.getMessage()));
        }
    }

    // ── Update ────────────────────────────────────────────────────────────────

    /**
     * Partially update a KPI formula. All fields are optional — only supplied fields are changed.
     *
     * Request body (all optional):
     * <pre>
     * {
     *   "displayName": "...",
     *   "formula":     "...",
     *   "variables":   { ... },
     *   "unit":        "...",
     *   "enabled":     false
     * }
     * </pre>
     */
    @PatchMapping("/api/v1/kpi-formulas/{id}")
    public ResponseEntity<?> updateFormula(@PathVariable String id,
                                            @RequestBody Map<String, Object> body) {
        log.info("PATCH /api/v1/kpi-formulas/{}", id);
        UUID formulaId = parseUUID(id, "formula ID");

        String displayName = (String) body.get("displayName");
        String formula     = (String) body.get("formula");
        String variables   = body.containsKey("variables") ? extractVariablesJson(body) : null;
        String unit        = (String) body.get("unit");
        Boolean enabled    = body.get("enabled") instanceof Boolean b ? b : null;
        if (variables != null) {
            tenantBodyGuard.requireReferenceToAll(ResourceKind.OBJECT, metricPointIdsOf(variables));
        }

        try {
            KpiFormula updated = kpiFormulaService.updateFormula(
                    formulaId, displayName, formula, variables, unit, enabled);
            return ResponseEntity.ok(Map.of("formula", toDto(updated)));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        } catch (ValidationException e) {
            return ResponseEntity.badRequest().body(Map.of("message", e.getMessage()));
        }
    }

    // ── Delete ────────────────────────────────────────────────────────────────

    /**
     * Delete a KPI formula by ID.
     */
    @DeleteMapping("/api/v1/kpi-formulas/{id}")
    public ResponseEntity<?> deleteFormula(@PathVariable String id) {
        log.info("DELETE /api/v1/kpi-formulas/{}", id);
        UUID formulaId = parseUUID(id, "formula ID");
        try {
            kpiFormulaService.deleteFormula(formulaId);
            return ResponseEntity.noContent().build();
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        }
    }

    // ── AI Generate ───────────────────────────────────────────────────────────

    /**
     * POST /api/v1/objects/{objectId}/kpi-formulas/generate
     * Natural-language formula generation via the configured n8n AI workflow.
     *
     * Request body:
     * <pre>
     * {
     *   "prompt":    "Calculate the COP from heat output and electrical input",
     *   "projectId": "uuid"   // optional — scopes available metric points to the project graph
     * }
     * </pre>
     *
     * Returns 503 when AI generation is not configured, 500 on unexpected errors.
     */
    @PostMapping("/api/v1/objects/{objectId}/kpi-formulas/generate")
    public ResponseEntity<?> generateFormula(@PathVariable String objectId,
                                              @RequestBody Map<String, Object> body) {
        log.info("POST /api/v1/objects/{}/kpi-formulas/generate", objectId);
        UUID objId = parseUUID(objectId, "object ID");

        String prompt = body.get("prompt") instanceof String s ? s.trim() : null;
        if (prompt == null || prompt.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("message", "'prompt' is required"));
        }

        String projectIdStr = body.get("projectId") instanceof String s ? s : null;
        UUID projectId = projectIdStr != null ? parseUUID(projectIdStr, "project ID") : null;
        tenantBodyGuard.requireReference(ResourceKind.PROJECT, projectId);

        try {
            KpiFormulaGenerationService.KpiFormulaGenerationResult result =
                    kpiFormulaGenerationService.generate(objId, projectId, prompt);
            return ResponseEntity.ok(result);
        } catch (IllegalStateException e) {
            return ResponseEntity.status(503).body(Map.of("message", e.getMessage()));
        } catch (Exception e) {
            log.error("KPI formula generation failed for object {}", objId, e);
            return ResponseEntity.internalServerError().body(Map.of("message", e.getMessage()));
        }
    }

    // ── Manual Evaluate ───────────────────────────────────────────────────────

    /**
     * Manually trigger evaluation of a formula and persist the result to derived_properties.
     *
     * Response on success:
     * <pre>{ "formula": {...}, "result": 3.14, "quality": "GOOD" }</pre>
     *
     * Response when data is insufficient:
     * <pre>{ "formula": {...}, "result": null, "quality": "INSUFFICIENT_DATA" }</pre>
     */
    @PostMapping("/api/v1/kpi-formulas/{id}/evaluate")
    public ResponseEntity<?> evaluateFormula(@PathVariable String id) {
        log.info("POST /api/v1/kpi-formulas/{}/evaluate", id);
        UUID formulaId = parseUUID(id, "formula ID");

        KpiFormula formula = kpiFormulaService.getFormula(formulaId)
                .orElseThrow(() -> new ResourceNotFoundException("KpiFormula", formulaId));

        Optional<Double> result = kpiFormulaService.evaluateFormula(formula);
        if (result.isPresent()) {
            try {
                kpiFormulaService.evaluateAndPersist(formula);
            } catch (Exception e) {
                log.warn("Failed to persist KPI formula result for {}: {}", formulaId, e.getMessage());
            }
            return ResponseEntity.ok(Map.of(
                    "formula", toDto(formula),
                    "result",  result.get(),
                    "quality", "GOOD"
            ));
        } else {
            Map<String, Object> response = new LinkedHashMap<>();
            response.put("formula", toDto(formula));
            response.put("result",  null);
            response.put("quality", "INSUFFICIENT_DATA");
            return ResponseEntity.ok(response);
        }
    }

    // ── History (time series) ───────────────────────────────────────────────

    /**
     * Return historical KPI values as time series data points.
     * Reads from derived_properties which are persisted on every measurement batch.
     *
     * <pre>GET /api/v1/kpi-formulas/{id}/history?from=1711800000&to=1711886400</pre>
     */
    @GetMapping("/api/v1/kpi-formulas/{id}/history")
    public ResponseEntity<?> getHistory(
            @PathVariable String id,
            @RequestParam long from,
            @RequestParam long to) {
        UUID formulaId = parseUUID(id, "formula ID");
        KpiFormula formula = kpiFormulaService.getFormula(formulaId)
                .orElseThrow(() -> new ResourceNotFoundException("KpiFormula", formulaId));

        List<DerivedProperty> history = derivedPropertyService.getHistoryInRange(
                formula.getObjectId(), formula.getName(), from, to);

        List<Map<String, Object>> points = history.stream().map(dp -> {
            Map<String, Object> point = new LinkedHashMap<>();
            point.put("time", dp.getValidFrom().getEpochSecond());
            point.put("value", dp.getValueNumeric());
            point.put("quality", dp.getQuality());
            return point;
        }).toList();

        return ResponseEntity.ok(Map.of(
                "formula", toDto(formula),
                "points", points
        ));
    }

    // ── DTO serialisation ─────────────────────────────────────────────────────

    /**
     * Convert a KpiFormula entity to a flat response map.
     * The {@code variables} field is deserialised from JSON string back to a Map
     * so the HTTP response contains a proper JSON object rather than an escaped string.
     */
    private Map<String, Object> toDto(KpiFormula f) {
        Map<String, Object> dto = new LinkedHashMap<>();
        dto.put("id",          f.getId());
        dto.put("objectId",    f.getObjectId());
        dto.put("name",        f.getName());
        dto.put("displayName", f.getDisplayName());
        dto.put("formula",     f.getFormula());
        dto.put("variables",   parseVariablesRaw(f.getVariables()));
        dto.put("unit",        f.getUnit());
        dto.put("enabled",     f.isEnabled());
        dto.put("tenantId",    f.getTenantId());
        dto.put("createdAt",   f.getCreatedAt());
        dto.put("updatedAt",   f.getUpdatedAt());
        return dto;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

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

    /**
     * Extract the "variables" field from the request body and convert it to a JSON string.
     * Accepts both a Map (from JSON object in the request) and a pre-serialised string.
     */
    /** The metric points a variables document binds directly, for the tenant guard. */
    @SuppressWarnings("unchecked")
    private List<UUID> metricPointIdsOf(String variablesJson) {
        Object raw = parseVariablesRaw(variablesJson);
        if (!(raw instanceof Map<?, ?> vars)) {
            return List.of();
        }
        List<UUID> ids = new ArrayList<>();
        for (Object binding : vars.values()) {
            if (binding instanceof Map<?, ?> b && b.get("metricPointId") instanceof String id) {
                try {
                    ids.add(UUID.fromString(id));
                } catch (IllegalArgumentException ignored) {
                    // The service reports malformed ids as a validation error.
                }
            }
        }
        return ids;
    }

    private String extractVariablesJson(Map<String, Object> body) {
        Object raw = body.get("variables");
        if (raw == null) return "{}";
        if (raw instanceof Map<?, ?> m) return toJson(m);
        if (raw instanceof String s) return s;
        return "{}";
    }

    @SuppressWarnings("unchecked")
    private Object parseVariablesRaw(String json) {
        if (json == null || json.isBlank()) return Map.of();
        try {
            return MAPPER.readValue(json, Map.class);
        } catch (Exception e) {
            return Map.of();
        }
    }

    private String toJson(Object obj) {
        try {
            return MAPPER.writeValueAsString(obj);
        } catch (Exception e) {
            return "{}";
        }
    }
}
