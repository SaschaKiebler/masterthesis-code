package com.digitaldemon.core.kpiformula;

import com.digitaldemon.core.kpiformula.KpiFormula;
import com.digitaldemon.core.metricpoint.MetricPoint;
import com.digitaldemon.core.proto.v1.IngestedMeasurement;
import com.digitaldemon.core.proto.v1.MeasurementBatch;
import com.digitaldemon.core.kpiformula.KpiFormulaRepository;
import com.digitaldemon.core.metricpoint.MetricPointRepository;
import com.digitaldemon.core.ontology.ObjectRepository;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * KpiFormulaEvaluator — triggered by MeasurementBatchListener after threshold evaluation.
 *
 * Evaluation strategy:
 * <ul>
 *   <li><b>DIRECT formulas</b> — trigger only when a variable's metric point appears in the
 *       arriving batch, giving near-real-time KPI updates.</li>
 *   <li><b>TRAVERSE formulas</b> — trigger on any batch but subject to a 60-second cooldown
 *       to prevent flooding when data arrives at high frequency.</li>
 * </ul>
 *
 * The tenant is resolved internally from metric points in the batch so that
 * this evaluator has no dependency on the HTTP security context (it runs on the MQTT thread).
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class KpiFormulaEvaluator {

    /** Minimum seconds between successive TRAVERSE evaluations for the same formula. */
    private static final long TRAVERSE_COOLDOWN_SECONDS = 60L;

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final KpiFormulaService kpiFormulaService;
    private final MetricPointRepository metricPointRepository;
    private final KpiFormulaRepository kpiFormulaRepository;
    private final ObjectRepository objectRepository;

    /** Per-formula cooldown tracker: formulaId → last successfully evaluated instant. */
    private final ConcurrentHashMap<UUID, Instant> lastEvaluated = new ConcurrentHashMap<>();

    // ── Public entry point ────────────────────────────────────────────────────

    /**
     * Entry point called from MeasurementBatchListener for each incoming protobuf batch.
     * Resolves the tenant internally so callers need not carry tenant context.
     *
     * @param batch deserialized MeasurementBatch from the heizung/measurements/processed topic
     */
    public void evaluate(MeasurementBatch batch) {
        UUID tenantId = resolveTenantId(batch);
        if (tenantId == null) {
            log.warn("Could not resolve tenantId for device={} ({} measurements) — skipping KPI evaluation",
                    batch.getDeviceId(), batch.getMeasurementsCount());
            return;
        }
        evaluateForTenant(batch, tenantId);
    }

    // ── Internal evaluation ───────────────────────────────────────────────────

    /**
     * Load all enabled formulas for the tenant and evaluate each one if the trigger
     * conditions are satisfied for the arriving batch.
     */
    private void evaluateForTenant(MeasurementBatch batch, UUID tenantId) {
        List<KpiFormula> formulas = kpiFormulaRepository.findByTenantIdAndEnabledTrue(tenantId);
        if (formulas.isEmpty()) {
            log.debug("No enabled KPI formulas for tenant={}", tenantId);
            return;
        }

        Set<UUID> batchMetricPointIds = resolveBatchMetricPointIds(batch);

        for (KpiFormula formula : formulas) {
            try {
                if (shouldEvaluate(formula, batchMetricPointIds)) {
                    log.info("Evaluating KPI formula '{}' (id={}) for device={}",
                            formula.getName(), formula.getId(), batch.getDeviceId());
                    kpiFormulaService.evaluateAndPersist(formula);
                    lastEvaluated.put(formula.getId(), Instant.now());
                }
            } catch (Exception e) {
                log.warn("Error evaluating KPI formula {} ({}): {}",
                        formula.getId(), formula.getName(), e.getMessage(), e);
            }
        }
    }

    /**
     * Determine whether a formula should be evaluated for this batch.
     *
     * <ul>
     *   <li>DIRECT: triggers if any of the formula's bound metric points appear in the batch.</li>
     *   <li>TRAVERSE: triggers if the cooldown window has elapsed (default 60 s).</li>
     *   <li>Mixed (DIRECT + TRAVERSE): triggers on either condition.</li>
     * </ul>
     */
    private boolean shouldEvaluate(KpiFormula formula, Set<UUID> batchMetricPointIds) {
        Map<String, Map<String, Object>> variables = parseVariables(formula.getVariables());
        if (variables.isEmpty()) return false;

        boolean hasTraverse     = false;
        boolean hasDirect       = false;
        boolean directTriggered = false;

        for (Map<String, Object> binding : variables.values()) {
            String mode = (String) binding.get("mode");
            if ("DIRECT".equals(mode)) {
                hasDirect = true;
                String mpId = (String) binding.get("metricPointId");
                if (mpId != null) {
                    try {
                        if (batchMetricPointIds.contains(UUID.fromString(mpId))) {
                            directTriggered = true;
                        }
                    } catch (IllegalArgumentException ignored) {
                        // malformed UUID in binding — skip
                    }
                }
            } else if ("TRAVERSE".equals(mode)) {
                hasTraverse = true;
            }
        }

        if (directTriggered) return true;

        if (hasTraverse) {
            Instant last = lastEvaluated.get(formula.getId());
            return last == null
                    || Instant.now().isAfter(last.plusSeconds(TRAVERSE_COOLDOWN_SECONDS));
        }

        if (hasDirect && !directTriggered) {
            log.debug("Formula '{}' (id={}) skipped: DIRECT variables not in batch (batch has {} metric points)",
                    formula.getName(), formula.getId(), batchMetricPointIds.size());
        }

        return false;
    }

    // ── Tenant resolution ─────────────────────────────────────────────────────

    /**
     * Resolve the tenant UUID from metric points in the batch.
     * Tries each measurement's metric point until a tenant is found, avoiding
     * dependence on a single metric entry that may be missing from the DB.
     *
     * <p>Uses a direct SQL query ({@code SELECT tenant_id FROM objects}) to avoid
     * lazy-loading issues — this evaluator runs on a CompletableFuture thread
     * without a persistent Hibernate session.</p>
     *
     * @return the tenant UUID, or null if none could be resolved
     */
    private UUID resolveTenantId(MeasurementBatch batch) {
        if (batch.getMeasurementsCount() == 0) return null;

        String deviceId = batch.getDeviceId();

        for (IngestedMeasurement m : batch.getMeasurementsList()) {
            Optional<MetricPoint> mpOpt = metricPointRepository
                    .findByDeviceIdAndMetricId(deviceId, (short) m.getMetricId());
            if (mpOpt.isEmpty()) continue;

            Optional<UUID> tenantId = objectRepository.findTenantIdByObjectId(mpOpt.get().getId());
            if (tenantId.isPresent()) {
                return tenantId.get();
            }
        }

        return null;
    }

    // ── Batch metric point resolution ─────────────────────────────────────────

    /**
     * Resolve the set of metric point UUIDs that correspond to measurements in this batch.
     * Used to determine which DIRECT-mode formulas should fire.
     */
    private Set<UUID> resolveBatchMetricPointIds(MeasurementBatch batch) {
        String deviceId = batch.getDeviceId();
        Set<UUID> result = new HashSet<>();
        for (IngestedMeasurement m : batch.getMeasurementsList()) {
            metricPointRepository
                    .findByDeviceIdAndMetricId(deviceId, (short) m.getMetricId())
                    .ifPresent(mp -> result.add(mp.getId()));
        }
        return result;
    }

    // ── JSON parsing ──────────────────────────────────────────────────────────

    /**
     * Parse the JSONB variables string into a raw map for trigger-condition checking.
     * Returns an empty map on parse error or missing data.
     */
    private Map<String, Map<String, Object>> parseVariables(String variablesJson) {
        if (variablesJson == null || variablesJson.isBlank() || "{}".equals(variablesJson.trim())) {
            return Collections.emptyMap();
        }
        try {
            return MAPPER.readValue(variablesJson, new TypeReference<>() {});
        } catch (Exception e) {
            log.warn("Failed to parse formula variables JSON in evaluator: {}", e.getMessage());
            return Collections.emptyMap();
        }
    }
}
