package com.heatingplatform.core.anomalyrule;

import com.heatingplatform.core.anomalyrule.AnomalyRuleTemplates.TemplateDescriptor;
import com.heatingplatform.core.common.exception.ResourceNotFoundException;
import com.heatingplatform.core.common.exception.ValidationException;
import com.heatingplatform.core.ontology.ObjectEntity;
import com.heatingplatform.core.ontology.OntologyService;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Slf4j
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class AnomalyRuleService {

    private static final Set<String> VALID_SEVERITIES = Set.of("INFO", "WARNING", "ERROR", "CRITICAL");
    private static final Set<String> VALID_AGGREGATES =
            Set.of("mean", "min", "max", "last", "duty", "edges_per_hour", "t_out");
    private static final Set<String> VALID_OPERATORS = Set.of("GT", "LT", "GTE", "LTE");

    private static final ObjectMapper objectMapper = new ObjectMapper();

    public record Binding(String role, UUID metricPointId) {}

    private final AnomalyRuleRepository ruleRepository;
    private final OntologyService ontologyService;
    /** Provider because the projection bean only exists when kafka.enabled=true. */
    private final ObjectProvider<AnomalyRuleConfigProjection> ruleConfigProjection;

    public List<AnomalyRule> listAll() {
        return ruleRepository.findAll();
    }

    /** Rules whose bindings reference any of the given metric points. */
    public List<AnomalyRule> listForMetricPoints(Set<UUID> metricPointIds) {
        return ruleRepository.findAll().stream()
                .filter(rule -> parseBindings(rule.getBindings()).stream()
                        .anyMatch(b -> metricPointIds.contains(b.metricPointId())))
                .toList();
    }

    @Transactional
    public AnomalyRule createRule(String name, String detector, Map<String, Object> params,
                                  List<Binding> bindings, String severity, int cooldownSeconds) {
        TemplateDescriptor template = AnomalyRuleTemplates.byKey(detector)
                .orElseThrow(() -> new ValidationException("Unknown detector template: " + detector));
        validate(template, params, bindings, severity);

        // Rules are tenant-scoped; the tenant comes from the first bound metric point.
        ObjectEntity first = ontologyService.getObject(bindings.get(0).metricPointId());
        if (first.getTenant() == null) {
            throw new IllegalStateException(
                    "MetricPoint " + bindings.get(0).metricPointId() + " has no tenant");
        }

        AnomalyRule rule = new AnomalyRule();
        rule.setTenantId(first.getTenant().getId());
        rule.setName(name);
        rule.setDetector(detector);
        rule.setParams(writeJson(params));
        rule.setBindings(writeJson(bindings.stream()
                .map(b -> Map.of("role", b.role(), "metricPointId", b.metricPointId().toString()))
                .toList()));
        rule.setSeverity(severity.toUpperCase());
        rule.setCooldownSeconds(cooldownSeconds);
        rule.setEnabled(true);

        AnomalyRule saved = ruleRepository.save(rule);
        log.info("Created anomaly rule {} '{}' ({}, {} bindings)",
                saved.getId(), name, detector, bindings.size());
        sweepAfterCommit();
        return saved;
    }

    @Transactional
    public AnomalyRule updateRule(UUID ruleId, String name, Map<String, Object> params,
                                  List<Binding> bindings, String severity,
                                  Integer cooldownSeconds, Boolean enabled) {
        AnomalyRule rule = ruleRepository.findById(ruleId)
                .orElseThrow(() -> new ResourceNotFoundException("AnomalyRule not found: " + ruleId));
        TemplateDescriptor template = AnomalyRuleTemplates.byKey(rule.getDetector()).orElseThrow();

        Map<String, Object> effectiveParams = params != null ? params : readParams(rule.getParams());
        List<Binding> effectiveBindings = bindings != null ? bindings : parseBindings(rule.getBindings());
        String effectiveSeverity = severity != null ? severity : rule.getSeverity();
        validate(template, effectiveParams, effectiveBindings, effectiveSeverity);

        if (name != null)            rule.setName(name);
        if (params != null)          rule.setParams(writeJson(params));
        if (bindings != null)        rule.setBindings(writeJson(bindings.stream()
                .map(b -> Map.of("role", b.role(), "metricPointId", b.metricPointId().toString()))
                .toList()));
        if (severity != null)        rule.setSeverity(severity.toUpperCase());
        if (cooldownSeconds != null) rule.setCooldownSeconds(cooldownSeconds);
        if (enabled != null)         rule.setEnabled(enabled);

        AnomalyRule saved = ruleRepository.save(rule);
        sweepAfterCommit();
        return saved;
    }

    @Transactional
    public void deleteRule(UUID ruleId) {
        if (!ruleRepository.existsById(ruleId)) {
            throw new ResourceNotFoundException("AnomalyRule not found: " + ruleId);
        }
        ruleRepository.deleteById(ruleId);
        log.info("Deleted anomaly rule {}", ruleId);
        sweepAfterCommit();
    }

    // ── Validation ────────────────────────────────────────────────────────

    private void validate(TemplateDescriptor template, Map<String, Object> params,
                          List<Binding> bindings, String severity) {
        if (!VALID_SEVERITIES.contains(severity.toUpperCase())) {
            throw new ValidationException("severity must be one of: INFO, WARNING, ERROR, CRITICAL");
        }
        if (bindings == null || bindings.isEmpty()) {
            throw new ValidationException("At least one channel binding is required");
        }
        Set<String> boundRoles = new LinkedHashSet<>();
        for (Binding binding : bindings) {
            if (binding.role() == null || binding.role().isBlank()) {
                throw new ValidationException("Every binding needs a role");
            }
            if (!boundRoles.add(binding.role())) {
                throw new ValidationException("Duplicate binding for role '" + binding.role() + "'");
            }
            // Existence check — throws ResourceNotFoundException for unknown ids.
            ontologyService.getObject(binding.metricPointId());
        }

        if (!template.dynamicRoles()) {
            for (var role : template.roles()) {
                if (role.required() && !boundRoles.contains(role.role())) {
                    throw new ValidationException(
                            "Template '" + template.key() + "' requires a binding for role '" + role.role() + "'");
                }
            }
            Set<String> known = new LinkedHashSet<>();
            template.roles().forEach(r -> known.add(r.role()));
            known.add(AnomalyRuleTemplates.SUPPRESS_ROLE);
            for (String role : boundRoles) {
                if (!known.contains(role)) {
                    throw new ValidationException(
                            "Template '" + template.key() + "' has no role '" + role + "'");
                }
            }
            for (Object value : params.values()) {
                if (!(value instanceof Number)) {
                    throw new ValidationException("Template parameters must be numeric");
                }
            }
            Set<String> knownParams = new LinkedHashSet<>();
            template.params().forEach(p -> knownParams.add(p.key()));
            for (String key : params.keySet()) {
                if (!knownParams.contains(key)) {
                    throw new ValidationException(
                            "Template '" + template.key() + "' has no parameter '" + key + "'");
                }
            }
        } else {
            validateConditionTree(params, boundRoles);
        }
    }

    /** Structural check of the `condition` template's condition tree. */
    private void validateConditionTree(Map<String, Object> params, Set<String> boundRoles) {
        Object condition = params.get("condition");
        if (condition == null) {
            throw new ValidationException("The condition template requires params.condition");
        }
        validateConditionNode(objectMapper.valueToTree(condition), boundRoles);
    }

    private void validateConditionNode(JsonNode node, Set<String> boundRoles) {
        if (node.has("all") || node.has("any")) {
            JsonNode children = node.has("all") ? node.get("all") : node.get("any");
            if (!children.isArray() || children.isEmpty()) {
                throw new ValidationException("all/any needs a non-empty list of conditions");
            }
            children.forEach(child -> validateConditionNode(child, boundRoles));
            return;
        }
        String agg = node.path("agg").asText("");
        if (!VALID_AGGREGATES.contains(agg)) {
            throw new ValidationException("Unknown aggregate '" + agg + "'");
        }
        if (!VALID_OPERATORS.contains(node.path("op").asText(""))) {
            throw new ValidationException("Condition op must be one of: GT, LT, GTE, LTE");
        }
        if (!node.path("value").isNumber()) {
            throw new ValidationException("Condition value must be a number");
        }
        if ("t_out".equals(agg)) {
            return; // context variable, no channel
        }
        String role = node.path("role").asText("");
        if (!boundRoles.contains(role)) {
            throw new ValidationException("Condition references unbound role '" + role + "'");
        }
        if (!node.path("window_s").isNumber() || node.path("window_s").asDouble() <= 0) {
            throw new ValidationException("Condition needs a positive window_s");
        }
    }

    // ── JSON helpers ──────────────────────────────────────────────────────

    public static List<Binding> parseBindings(String json) {
        try {
            List<Map<String, String>> raw = objectMapper.readValue(json, new TypeReference<>() {});
            return raw.stream()
                    .map(m -> new Binding(m.get("role"), UUID.fromString(m.get("metricPointId"))))
                    .toList();
        } catch (Exception e) {
            throw new IllegalStateException("Unreadable bindings JSON: " + json, e);
        }
    }

    public static Map<String, Object> readParams(String json) {
        try {
            return objectMapper.readValue(json, new TypeReference<>() {});
        } catch (Exception e) {
            throw new IllegalStateException("Unreadable params JSON: " + json, e);
        }
    }

    private static String writeJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception e) {
            throw new IllegalStateException("Unserializable JSON payload", e);
        }
    }

    /**
     * Push the config projection right after the mutating transaction commits,
     * so rule changes reach the analytics engine without waiting for the
     * periodic reconciliation sweep.
     */
    private void sweepAfterCommit() {
        ruleConfigProjection.ifAvailable(projection -> {
            if (TransactionSynchronizationManager.isSynchronizationActive()) {
                TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                    @Override
                    public void afterCommit() {
                        projection.sweep();
                    }
                });
            } else {
                projection.sweep();
            }
        });
    }
}
