package com.digitaldemon.notification;

import com.digitaldemon.notification.persistence.NotificationRule;
import com.digitaldemon.notification.persistence.NotificationRuleRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Per-tenant cache of the enabled notification rules, short TTL so rule
 * changes via the REST API reach the consumer without a restart while the
 * hot path stays off the database.
 */
@Component
@RequiredArgsConstructor
public class RuleCache {

    private static final Duration TTL = Duration.ofSeconds(30);

    private final NotificationRuleRepository ruleRepository;

    private record Entry(Instant loadedAt, List<NotificationRule> rules) {
    }

    private final ConcurrentHashMap<UUID, Entry> cache = new ConcurrentHashMap<>();

    public List<NotificationRule> enabledRulesFor(UUID tenantId) {
        Entry entry = cache.get(tenantId);
        Instant now = Instant.now();
        if (entry != null && Duration.between(entry.loadedAt(), now).compareTo(TTL) < 0) {
            return entry.rules();
        }
        List<NotificationRule> rules = ruleRepository.findEnabledByTenant(tenantId);
        cache.put(tenantId, new Entry(now, rules));
        return rules;
    }

    /** Called by the REST API after a mutation so changes apply immediately. */
    public void invalidate(UUID tenantId) {
        cache.remove(tenantId);
    }
}
