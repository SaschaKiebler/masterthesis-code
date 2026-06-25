package com.digitaldemon.core.kpiformula;

import com.digitaldemon.core.kpiformula.KpiFormula;
import com.digitaldemon.core.kpiformula.KpiFormulaRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * Scheduled fallback for KPI formula evaluation.
 *
 * <p>The primary evaluation path is MQTT-driven ({@link KpiFormulaEvaluator}), but it
 * depends on the MQTT broker being reachable and the ingestion service publishing
 * measurement batches. This scheduler provides a guaranteed periodic evaluation of all
 * enabled formulas regardless of MQTT connectivity.</p>
 *
 * <p>Runs every 30 seconds. Each formula is evaluated independently — a failure on one
 * formula does not affect others.</p>
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class KpiFormulaScheduler {

    private final KpiFormulaRepository kpiFormulaRepository;
    private final KpiFormulaService kpiFormulaService;

    @Scheduled(fixedDelay = 30_000, initialDelay = 10_000)
    public void evaluateAll() {
        List<KpiFormula> formulas = kpiFormulaRepository.findByEnabledTrue();
        if (formulas.isEmpty()) return;

        log.debug("Scheduled KPI evaluation: {} enabled formula(s)", formulas.size());

        int evaluated = 0;
        for (KpiFormula formula : formulas) {
            try {
                kpiFormulaService.evaluateAndPersist(formula);
                evaluated++;
            } catch (Exception e) {
                log.warn("Scheduled evaluation failed for formula '{}' (id={}): {}",
                        formula.getName(), formula.getId(), e.getMessage());
            }
        }

        if (evaluated > 0) {
            log.info("Scheduled KPI evaluation: {}/{} formulas evaluated successfully",
                    evaluated, formulas.size());
        }
    }
}
