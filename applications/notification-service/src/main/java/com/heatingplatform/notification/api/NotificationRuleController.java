package com.heatingplatform.notification.api;

import com.heatingplatform.notification.RuleCache;
import com.heatingplatform.notification.auth.TenantResolver;
import com.heatingplatform.notification.persistence.NotificationRule;
import com.heatingplatform.notification.persistence.NotificationRuleRepository;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.UUID;

/** Per-tenant notification rules (policy — strictly separate from core's threshold rules). */
@RestController
@RequestMapping("/api/v1/notification-rules")
@RequiredArgsConstructor
public class NotificationRuleController {

    private static final String SEVERITY_PATTERN = "INFO|WARNING|ERROR|CRITICAL";

    private final NotificationRuleRepository ruleRepository;
    private final RuleCache ruleCache;
    private final TenantResolver tenantResolver;

    public record CreateRuleRequest(
            @NotBlank String name,
            List<String> eventTypes,
            @Pattern(regexp = SEVERITY_PATTERN) String minSeverity,
            @Min(0) @Max(1440) Integer cooldownMinutes,
            String webhookUrl,
            String webhookToken,
            Boolean enabled) {
    }

    public record UpdateRuleRequest(
            String name,
            List<String> eventTypes,
            @Pattern(regexp = SEVERITY_PATTERN) String minSeverity,
            @Min(0) @Max(1440) Integer cooldownMinutes,
            String webhookUrl,
            String webhookToken,
            Boolean enabled) {
    }

    @GetMapping
    public List<NotificationRule> list(@RequestParam(required = false) UUID tenantId) {
        return ruleRepository.findByTenant(tenantResolver.resolveTenant(tenantId));
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public NotificationRule create(@RequestParam(required = false) UUID tenantId,
                                   @Valid @RequestBody CreateRuleRequest request) {
        UUID tenant = tenantResolver.resolveTenant(tenantId);
        NotificationRule rule = ruleRepository.insert(
                tenant,
                request.name(),
                request.eventTypes() == null || request.eventTypes().isEmpty()
                        ? List.of("threshold.breached", "anomaly.detected")
                        : request.eventTypes(),
                request.minSeverity() == null ? "INFO" : request.minSeverity(),
                request.cooldownMinutes() == null ? 15 : request.cooldownMinutes(),
                request.webhookUrl(),
                request.webhookToken(),
                request.enabled() == null || request.enabled());
        ruleCache.invalidate(tenant);
        return rule;
    }

    @PatchMapping("/{id}")
    public NotificationRule update(@PathVariable UUID id,
                                   @RequestParam(required = false) UUID tenantId,
                                   @Valid @RequestBody UpdateRuleRequest request) {
        UUID tenant = tenantResolver.resolveTenant(tenantId);
        NotificationRule rule = ruleRepository.update(
                        id, tenant,
                        request.name(),
                        request.eventTypes(),
                        request.minSeverity(),
                        request.cooldownMinutes(),
                        request.webhookUrl(),
                        request.webhookToken(),
                        request.enabled())
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND, "Rule not found"));
        ruleCache.invalidate(tenant);
        return rule;
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable UUID id,
                       @RequestParam(required = false) UUID tenantId) {
        UUID tenant = tenantResolver.resolveTenant(tenantId);
        if (!ruleRepository.delete(id, tenant)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Rule not found");
        }
        ruleCache.invalidate(tenant);
    }
}
