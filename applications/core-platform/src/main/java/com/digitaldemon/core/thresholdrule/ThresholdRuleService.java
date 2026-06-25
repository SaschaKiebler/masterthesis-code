package com.digitaldemon.core.thresholdrule;

import com.digitaldemon.core.ontology.OntologyService;

import com.digitaldemon.core.ontology.ObjectEntity;
import com.digitaldemon.core.thresholdrule.ThresholdRule;
import com.digitaldemon.core.common.exception.ResourceNotFoundException;
import com.digitaldemon.core.thresholdrule.ThresholdRuleRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Slf4j
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class ThresholdRuleService {

    private final ThresholdRuleRepository ruleRepository;
    private final OntologyService ontologyService;

    public List<ThresholdRule> getRulesForMetricPoint(UUID metricPointId) {
        return ruleRepository.findByMetricPointId(metricPointId);
    }

    @Transactional
    public ThresholdRule createRule(UUID metricPointId, String operator, Double threshold,
                                   String severity, int cooldownSeconds) {
        // Resolve tenant from the metric point's object — rules are tenant-scoped.
        ObjectEntity mpObj = ontologyService.getObject(metricPointId);
        if (mpObj.getTenant() == null) {
            throw new IllegalStateException("MetricPoint " + metricPointId + " has no tenant");
        }
        UUID tenantId = mpObj.getTenant().getId();

        ThresholdRule rule = new ThresholdRule();
        rule.setMetricPointId(metricPointId);
        rule.setOperator(operator.toUpperCase());
        rule.setThreshold(threshold);   // null for state-change operators
        rule.setSeverity(severity.toUpperCase());
        rule.setCooldownSeconds(cooldownSeconds);
        rule.setTenantId(tenantId);
        rule.setEnabled(true);

        ThresholdRule saved = ruleRepository.save(rule);
        log.info("Created threshold rule {} for metric_point={} ({}{} severity={})",
                saved.getId(), metricPointId, operator,
                threshold != null ? " " + threshold : "", severity);
        return saved;
    }

    @Transactional
    public ThresholdRule updateRule(UUID ruleId, Double threshold, String operator,
                                   String severity, Integer cooldownSeconds, Boolean enabled) {
        ThresholdRule rule = ruleRepository.findById(ruleId)
                .orElseThrow(() -> new ResourceNotFoundException("ThresholdRule not found: " + ruleId));

        if (threshold != null)        rule.setThreshold(threshold);
        if (operator != null)         rule.setOperator(operator.toUpperCase());
        if (severity != null)         rule.setSeverity(severity.toUpperCase());
        if (cooldownSeconds != null)  rule.setCooldownSeconds(cooldownSeconds);
        if (enabled != null)          rule.setEnabled(enabled);

        return ruleRepository.save(rule);
    }

    @Transactional
    public void deleteRule(UUID ruleId) {
        if (!ruleRepository.existsById(ruleId)) {
            throw new ResourceNotFoundException("ThresholdRule not found: " + ruleId);
        }
        ruleRepository.deleteById(ruleId);
        log.info("Deleted threshold rule {}", ruleId);
    }
}
