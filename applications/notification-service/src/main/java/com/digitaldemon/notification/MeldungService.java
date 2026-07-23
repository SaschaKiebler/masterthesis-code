package com.digitaldemon.notification;

import com.digitaldemon.detection.proto.v1.DetectionEvent;
import com.digitaldemon.notification.delivery.AlertDeliverer;
import com.digitaldemon.notification.persistence.NotificationRepository;
import com.digitaldemon.notification.persistence.NotificationRule;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Meldungsverwaltung: turns a detection event into persisted, deduplicated
 * Meldungen according to the tenant's notification rules.
 *
 * Tenants without any configured rule get the implicit default rule derived
 * from the global notification.policy.* properties, so unconfigured tenants
 * keep receiving Meldungen. Dedup per (type, device, metric, rule) uses an
 * in-memory map with the newest persisted Meldung as restart backstop.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class MeldungService {

    private final NotificationProperties props;
    private final RuleCache ruleCache;
    private final NotificationRepository notificationRepository;
    private final AlertDeliverer deliverer;

    /** (tenant|rule|type|device|metric) → last persisted Meldung. */
    private final ConcurrentHashMap<String, Instant> lastPersisted = new ConcurrentHashMap<>();

    public void process(UUID tenantId, DetectionEvent event) {
        List<NotificationRule> rules = ruleCache.enabledRulesFor(tenantId);
        if (rules.isEmpty()) {
            rules = List.of(defaultRule(tenantId));
        }

        for (NotificationRule rule : rules) {
            if (!rule.eventTypes().contains(event.getType())) {
                continue;
            }
            if (!Severity.atLeast(event.getSeverity(), rule.minSeverity())) {
                continue;
            }
            if (isDuplicate(tenantId, rule, event)) {
                continue;
            }
            persist(tenantId, rule, event);
            deliverer.deliver(event, rule.webhookUrl(), rule.webhookToken());
        }
    }

    /** Implicit rule from the global properties (id = null, not persisted). */
    private NotificationRule defaultRule(UUID tenantId) {
        return new NotificationRule(
                null,
                tenantId,
                "default-policy",
                props.getTopics(),
                props.getPolicy().getMinSeverity().toUpperCase(),
                props.getPolicy().getCooldownMinutes(),
                emptyToNull(props.getWebhook().getUrl()),
                emptyToNull(props.getWebhook().getToken()),
                true,
                null,
                null);
    }

    private boolean isDuplicate(UUID tenantId, NotificationRule rule, DetectionEvent event) {
        int cooldownMinutes = rule.cooldownMinutes();
        if (cooldownMinutes <= 0) {
            return false;
        }
        String key = tenantId + "|" + rule.id() + "|" + event.getType()
                + "|" + event.getChannel().getDeviceId() + "|" + event.getChannel().getMetricId();
        Instant now = Instant.now();
        Instant last = lastPersisted.get(key);
        if (last == null) {
            // Restart backstop: consult the newest persisted Meldung.
            last = notificationRepository.lastCreatedAt(tenantId, rule.id(), event.getType(),
                            event.getChannel().getDeviceId(), event.getChannel().getMetricId())
                    .orElse(null);
        }
        if (last != null && Duration.between(last, now).toMinutes() < cooldownMinutes) {
            log.debug("Suppressed duplicate {} for {} — within {}min window",
                    event.getType(), key, cooldownMinutes);
            return true;
        }
        return false;
    }

    private void persist(UUID tenantId, NotificationRule rule, DetectionEvent event) {
        Instant detectedAt = event.hasDetectedAt()
                ? Instant.ofEpochSecond(event.getDetectedAt().getSeconds(), event.getDetectedAt().getNanos())
                : Instant.now();
        String summary = event.getSummary().isBlank()
                ? "%s on device %s".formatted(event.getType(), event.getChannel().getDeviceId())
                : event.getSummary();

        notificationRepository.insert(
                tenantId,
                rule.id(),
                event.getType(),
                event.getSeverity().isBlank() ? "INFO" : event.getSeverity().toUpperCase(),
                event.getChannel().getDeviceId(),
                event.getChannel().getMetricId(),
                parseUuid(event.getAssetRef()),
                summary,
                event.getDetail(),
                detectedAt);

        String key = tenantId + "|" + rule.id() + "|" + event.getType()
                + "|" + event.getChannel().getDeviceId() + "|" + event.getChannel().getMetricId();
        lastPersisted.put(key, Instant.now());
    }

    private static String emptyToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }

    private static UUID parseUuid(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    static Optional<UUID> tenantOf(DetectionEvent event) {
        return Optional.ofNullable(parseUuid(event.getTenantId()));
    }
}
