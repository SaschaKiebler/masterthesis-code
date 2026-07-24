package com.digitaldemon.core.kpiformula;

import com.digitaldemon.core.ontology.OntologyService;
import com.digitaldemon.core.derivedproperty.DerivedPropertyService;

import com.digitaldemon.core.kpiformula.KpiFormula;
import com.digitaldemon.core.metricpoint.MetricPoint;
import com.digitaldemon.core.ontology.ObjectEntity;
import com.digitaldemon.core.common.exception.ResourceNotFoundException;
import com.digitaldemon.core.common.exception.ValidationException;
import com.digitaldemon.core.kpiformula.KpiFormulaRepository;
import com.digitaldemon.core.measurement.LatestValueProjection;
import com.digitaldemon.core.metricpoint.MetricPointRepository;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.objecthunter.exp4j.Expression;
import net.objecthunter.exp4j.ExpressionBuilder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;
import java.util.stream.Collectors;

/**
 * KpiFormulaService — CRUD and evaluation of user-defined computed KPIs.
 *
 * Formula variables can be bound in two modes:
 * <ul>
 *   <li><b>DIRECT</b> — references a single MetricPoint by UUID and fetches its latest
 *       measurement value from the hypertable.</li>
 *   <li><b>TRAVERSE</b> — auto-discovers MetricPoints by following ontology links from the
 *       formula's anchor object (e.g. SUM of all heat_flow metrics from objects linked via
 *       FEEDS), then aggregates the latest values with SUM / AVG / MIN / MAX.</li>
 * </ul>
 *
 * Evaluation uses exp4j for safe, math-only expression parsing — no code injection risk.
 * Results are written to {@code derived_properties} so they are queryable alongside
 * ML-computed properties via {@link DerivedPropertyService}.
 */
@Service
@RequiredArgsConstructor
@Slf4j
@Transactional(readOnly = true)
public class KpiFormulaService {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final KpiFormulaRepository kpiFormulaRepository;
    private final MetricPointRepository metricPointRepository;
    /** Latest values come from the in-memory projection — no measurement-store read. */
    private final LatestValueProjection latestValueProjection;
    private final OntologyService ontologyService;
    private final DerivedPropertyService derivedPropertyService;

    // ── CRUD ──────────────────────────────────────────────────────────────────

    /**
     * Return all formulas attached to the given ontology object.
     */
    public List<KpiFormula> getFormulasForObject(UUID objectId) {
        return kpiFormulaRepository.findByObjectId(objectId);
    }

    /**
     * Return a single formula by ID.
     */
    public Optional<KpiFormula> getFormula(UUID id) {
        return kpiFormulaRepository.findById(id);
    }

    /**
     * Create and persist a new KPI formula.
     * Validates that the formula parses correctly before saving.
     *
     * @param objectId      Anchor object UUID (must exist in objects table)
     * @param name          Machine key used as the derived property name
     * @param displayName   Human-readable label for the UI
     * @param formula       Math expression string (exp4j syntax)
     * @param variablesJson JSONB string of variable bindings (null defaults to "{}")
     * @param unit          Optional SI unit for the result
     * @param tenantId      Tenant UUID for row-level security scoping
     * @return the persisted KpiFormula entity
     * @throws ValidationException if the formula fails to parse or validate
     */
    @Transactional
    public KpiFormula createFormula(UUID objectId, String name, String displayName,
                                    String formula, String variablesJson, String unit,
                                    UUID tenantId) {
        validateFormula(formula, variablesJson);

        KpiFormula f = new KpiFormula();
        f.setObjectId(objectId);
        f.setName(name);
        f.setDisplayName(displayName);
        f.setFormula(formula);
        f.setVariables(variablesJson != null ? variablesJson : "{}");
        f.setUnit(unit);
        f.setEnabled(true);
        f.setTenantId(tenantId);
        return kpiFormulaRepository.save(f);
    }

    /**
     * Update fields of an existing formula.
     * If formula or variables are changed, re-validates the combined expression.
     *
     * @param id            Formula UUID
     * @param displayName   New display name (null = no change)
     * @param formula       New formula string (null = no change)
     * @param variablesJson New variable bindings JSON (null = no change)
     * @param unit          New unit (null = no change)
     * @param enabled       New enabled state (null = no change)
     * @return the updated KpiFormula entity
     * @throws ResourceNotFoundException if the formula does not exist
     * @throws ValidationException       if the updated formula fails to parse
     */
    @Transactional
    public KpiFormula updateFormula(UUID id, String displayName, String formula,
                                    String variablesJson, String unit, Boolean enabled) {
        KpiFormula f = kpiFormulaRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("KpiFormula", id));

        if (formula != null || variablesJson != null) {
            String effectiveFormula = formula != null ? formula : f.getFormula();
            String effectiveVars    = variablesJson != null ? variablesJson : f.getVariables();
            validateFormula(effectiveFormula, effectiveVars);
        }

        if (displayName != null)   f.setDisplayName(displayName);
        if (formula != null)       f.setFormula(formula);
        if (variablesJson != null) f.setVariables(variablesJson);
        if (unit != null)          f.setUnit(unit);
        if (enabled != null)       f.setEnabled(enabled);

        return kpiFormulaRepository.save(f);
    }

    /**
     * Delete a formula by ID.
     *
     * @throws ResourceNotFoundException if the formula does not exist
     */
    @Transactional
    public void deleteFormula(UUID id) {
        if (!kpiFormulaRepository.existsById(id)) {
            throw new ResourceNotFoundException("KpiFormula", id);
        }
        kpiFormulaRepository.deleteById(id);
    }

    // ── Evaluation ────────────────────────────────────────────────────────────

    /**
     * Evaluate a formula and return the numeric result without persisting it.
     * Returns {@link Optional#empty()} if any required variable has no data or
     * if the result is non-finite (NaN, Infinity).
     *
     * @param formula the formula to evaluate
     * @return the computed value, or empty if data is insufficient
     */
    public Optional<Double> evaluateFormula(KpiFormula formula) {
        Map<String, VariableBinding> variables = parseVariables(formula.getVariables());
        if (variables.isEmpty()) {
            log.debug("Formula {} has no variables — skipping evaluation", formula.getId());
            return Optional.empty();
        }

        Map<String, Double> resolvedValues = new HashMap<>();

        for (Map.Entry<String, VariableBinding> entry : variables.entrySet()) {
            String varName          = entry.getKey();
            VariableBinding binding = entry.getValue();

            Optional<Double> value = resolveVariable(formula.getObjectId(), binding);
            if (value.isEmpty()) {
                log.info("Formula '{}' (id={}) variable '{}' (mode={}) has no data — skipping evaluation",
                        formula.getName(), formula.getId(), varName, binding.mode);
                return Optional.empty();
            }
            resolvedValues.put(varName, value.get());
        }

        try {
            Expression expr = new ExpressionBuilder(formula.getFormula())
                    .variables(resolvedValues.keySet())
                    .build();
            for (Map.Entry<String, Double> val : resolvedValues.entrySet()) {
                expr.setVariable(val.getKey(), val.getValue());
            }
            double result = expr.evaluate();
            if (!Double.isFinite(result)) {
                log.warn("Formula {} evaluated to non-finite value: {}", formula.getId(), result);
                return Optional.empty();
            }
            return Optional.of(result);
        } catch (Exception e) {
            log.warn("Formula {} evaluation error: {}", formula.getId(), e.getMessage());
            return Optional.empty();
        }
    }

    /**
     * Evaluate a formula and write the result to {@code derived_properties}.
     * If evaluation produces no result (insufficient data), the call is a no-op.
     *
     * @param formula the formula to evaluate and persist
     */
    @Transactional
    public void evaluateAndPersist(KpiFormula formula) {
        Optional<Double> result = evaluateFormula(formula);
        if (result.isEmpty()) {
            log.info("Formula '{}' (id={}) produced no result — not persisting",
                    formula.getName(), formula.getId());
            return;
        }
        derivedPropertyService.writeProperty(
                formula.getObjectId(),
                formula.getName(),
                formula.getDisplayName(),
                result.get(),
                null,
                formula.getUnit(),
                1.0,
                "GOOD",
                "RULE",
                formula.getId().toString(),
                null,
                formula.getTenantId()
        );
        log.debug("Persisted KPI formula result: {} = {} for object {}",
                formula.getName(), result.get(), formula.getObjectId());
    }

    // ── Variable resolution ───────────────────────────────────────────────────

    private Optional<Double> resolveVariable(UUID formulaObjectId, VariableBinding binding) {
        if ("DIRECT".equals(binding.mode)) {
            return resolveDirectVariable(binding);
        } else if ("TRAVERSE".equals(binding.mode)) {
            return resolveTraverseVariable(formulaObjectId, binding);
        }
        log.warn("Unknown variable binding mode: {}", binding.mode);
        return Optional.empty();
    }

    /**
     * DIRECT mode: look up a specific MetricPoint by UUID and return its latest measured value.
     */
    private Optional<Double> resolveDirectVariable(VariableBinding binding) {
        if (binding.metricPointId == null) return Optional.empty();
        try {
            UUID mpId   = UUID.fromString(binding.metricPointId);
            MetricPoint mp = metricPointRepository.findById(mpId).orElse(null);
            if (mp == null) return Optional.empty();
            return latestValueProjection.findLatestValue(mp.getDeviceId(), mp.getMetricId());
        } catch (IllegalArgumentException e) {
            log.warn("DIRECT binding has invalid metricPointId: {}", binding.metricPointId);
            return Optional.empty();
        }
    }

    /**
     * TRAVERSE mode: perform a multi-hop BFS from the formula's anchor object to discover all
     * transitively reachable objects, then find MetricPoints matching the given quantity/name
     * on those objects and aggregate their latest values.
     *
     * <p>When {@code binding.linkTypeName} is "ANY", all domain link types are traversed in both
     * directions (HAS_METRIC excluded). This allows formulas to work even when devices are
     * several hops away from the anchor.</p>
     */
    private Optional<Double> resolveTraverseVariable(UUID formulaObjectId, VariableBinding binding) {
        if (binding.quantityName == null || binding.quantityName.isBlank()) {
            log.warn("TRAVERSE binding missing quantityName");
            return Optional.empty();
        }

        List<ObjectEntity> neighbors = ontologyService.getReachableObjects(
                formulaObjectId, binding.linkTypeName, binding.direction);

        if (neighbors.isEmpty()) {
            log.debug("TRAVERSE: no reachable objects via {} ({})", binding.linkTypeName, binding.direction);
            return Optional.empty();
        }

        List<Double> values = collectTraverseValues(neighbors, binding.quantityName);
        if (values.isEmpty()) return Optional.empty();

        String agg = binding.aggregation != null ? binding.aggregation : "SUM";
        return switch (agg) {
            case "SUM" -> Optional.of(values.stream().mapToDouble(Double::doubleValue).sum());
            case "AVG" -> Optional.of(values.stream().mapToDouble(Double::doubleValue).average().orElse(0.0));
            case "MIN" -> Optional.of(values.stream().mapToDouble(Double::doubleValue).min().orElse(0.0));
            case "MAX" -> Optional.of(values.stream().mapToDouble(Double::doubleValue).max().orElse(0.0));
            default    -> {
                log.warn("Unknown aggregation '{}', defaulting to SUM", agg);
                yield Optional.of(values.stream().mapToDouble(Double::doubleValue).sum());
            }
        };
    }

    /**
     * For each reachable neighbor object, find MetricPoints matching the given quantity key
     * and fetch the latest measurement value.
     *
     * <p>Cascade match strategy (first non-empty match wins per neighbor):
     * <ol>
     *   <li><b>Physical quantity name</b> — {@code pq.name} in physical_quantities table
     *       (e.g. "power_heat", "temperature").</li>
     *   <li><b>MetricPoint display name</b> — {@code objects.display_name} set from the
     *       original signal-map entry name (e.g. "total_active_energy").</li>
     *   <li><b>Raw field path</b> — {@code metric_points.field}
     *       (e.g. "aenergy.total").</li>
     * </ol>
     * </p>
     */
    private List<Double> collectTraverseValues(List<ObjectEntity> neighbors, String quantityName) {
        List<Double> values = new ArrayList<>();

        for (ObjectEntity neighbor : neighbors) {
            UUID neighborTenantId = neighbor.getTenant() != null ? neighbor.getTenant().getId() : null;

            // Fetch all MetricPoints linked to this neighbor via HAS_METRIC (single query)
            List<MetricPoint> neighborMps = metricPointRepository
                    .findByAssetIdViaHasMetric(neighbor.getId(), neighborTenantId);

            if (neighborMps.isEmpty()) continue;

            Set<UUID> neighborMpIds = neighborMps.stream()
                    .map(MetricPoint::getId)
                    .collect(Collectors.toSet());

            // 1. Match by physical quantity name
            List<MetricPoint> matchingMps = metricPointRepository
                    .findByTenantAndQuantityName(neighborTenantId, quantityName)
                    .stream()
                    .filter(mp -> neighborMpIds.contains(mp.getId()))
                    .toList();

            // 2. Fallback: match by MetricPoint display name (original signal-map entry name)
            if (matchingMps.isEmpty()) {
                matchingMps = metricPointRepository
                        .findByAssetIdAndDisplayName(neighbor.getId(), neighborTenantId, quantityName);
            }

            // 3. Fallback: match by raw JSON field path (e.g. "aenergy.total")
            if (matchingMps.isEmpty()) {
                matchingMps = neighborMps.stream()
                        .filter(mp -> quantityName.equals(mp.getField()))
                        .toList();
            }

            for (MetricPoint mp : matchingMps) {
                latestValueProjection.findLatestValue(mp.getDeviceId(), mp.getMetricId())
                        .ifPresent(values::add);
            }
        }
        return values;
    }

    // ── Formula validation ────────────────────────────────────────────────────

    /**
     * Validate that the formula string is parseable and evaluable with the given variables.
     * Injects dummy values (1.0) for all declared variables to catch evaluation errors at
     * definition time rather than at runtime.
     *
     * @throws ValidationException if exp4j rejects the expression
     */
    private void validateFormula(String formula, String variablesJson) {
        Set<String> varNames = parseVariables(variablesJson).keySet();
        try {
            ExpressionBuilder builder = new ExpressionBuilder(formula);
            if (!varNames.isEmpty()) {
                builder.variables(varNames);
            }
            Expression expr = builder.build();
            for (String v : varNames) {
                expr.setVariable(v, 1.0);
            }
            expr.validate();
        } catch (Exception e) {
            throw new ValidationException("Invalid formula: " + e.getMessage());
        }
    }

    // ── JSON parsing ──────────────────────────────────────────────────────────

    /**
     * Parse the JSONB variables column into a typed map of variable name → binding descriptor.
     * Returns an empty map if the JSON is null, blank, or an empty object.
     */
    private Map<String, VariableBinding> parseVariables(String variablesJson) {
        if (variablesJson == null || variablesJson.isBlank() || "{}".equals(variablesJson.trim())) {
            return Collections.emptyMap();
        }
        try {
            Map<String, Map<String, Object>> raw = MAPPER.readValue(variablesJson,
                    new TypeReference<>() {});
            Map<String, VariableBinding> result = new LinkedHashMap<>();
            for (Map.Entry<String, Map<String, Object>> e : raw.entrySet()) {
                result.put(e.getKey(), VariableBinding.from(e.getValue()));
            }
            return result;
        } catch (Exception e) {
            log.warn("Failed to parse formula variables JSON: {}", e.getMessage());
            return Collections.emptyMap();
        }
    }

    // ── Inner types ───────────────────────────────────────────────────────────

    /**
     * Parsed representation of a single formula variable binding.
     * Deserialised from the JSONB {@code variables} column on the kpi_formulas table.
     */
    public static class VariableBinding {
        /** DIRECT — single metric point by UUID | TRAVERSE — graph-discovered metric points. */
        public String mode;
        /** Human-readable label for this variable (display only). */
        public String label;
        /** DIRECT only: UUID of the target MetricPoint. */
        public String metricPointId;
        /** Aggregation to apply when multiple values exist: LAST | SUM | AVG | MIN | MAX. */
        public String aggregation;
        /** TRAVERSE only: physical quantity name to match (e.g. "power", "temperature"). */
        public String quantityName;
        /** TRAVERSE only: link type name to follow (e.g. "FEEDS", "CONTAINS"). */
        public String linkTypeName;
        /** TRAVERSE only: OUTBOUND follows links from the anchor | INBOUND follows links to it. */
        public String direction;

        /**
         * Deserialise a raw binding map from Jackson.
         */
        public static VariableBinding from(Map<String, Object> map) {
            VariableBinding b = new VariableBinding();
            b.mode          = (String) map.get("mode");
            b.label         = (String) map.get("label");
            b.metricPointId = (String) map.get("metricPointId");
            b.aggregation   = (String) map.get("aggregation");
            b.quantityName  = (String) map.get("quantityName");
            b.linkTypeName  = (String) map.get("linkTypeName");
            b.direction     = (String) map.get("direction");
            return b;
        }
    }
}
