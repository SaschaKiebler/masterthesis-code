package com.digitaldemon.notification;

import com.digitaldemon.detection.proto.v1.DetectionEvent;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Notification policy: decides whether a detection event becomes a
 * notification. Deliberately thin (severity floor + optional dedup window);
 * escalation, quiet hours, and per-tenant channel routing are the growth
 * path described in the event catalog.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class NotificationPolicy {

    private static final Map<String, Integer> SEVERITY_RANK = Map.of(
            "INFO", 0,
            "WARNING", 1,
            "ERROR", 2,
            "CRITICAL", 3);

    private final NotificationProperties props;

    /** (type|device|metric) → last delivery time, for the dedup window. */
    private final ConcurrentHashMap<String, Instant> lastDelivered = new ConcurrentHashMap<>();

    public boolean shouldNotify(DetectionEvent event) {
        int rank = SEVERITY_RANK.getOrDefault(event.getSeverity().toUpperCase(), 0);
        int minRank = SEVERITY_RANK.getOrDefault(props.getPolicy().getMinSeverity().toUpperCase(), 0);
        if (rank < minRank) {
            log.debug("Suppressed {} for device={} — severity {} below floor {}",
                    event.getType(), event.getChannel().getDeviceId(),
                    event.getSeverity(), props.getPolicy().getMinSeverity());
            return false;
        }

        int cooldownMinutes = props.getPolicy().getCooldownMinutes();
        if (cooldownMinutes > 0) {
            String key = event.getType() + "|" + event.getChannel().getDeviceId()
                    + "|" + event.getChannel().getMetricId();
            Instant now = Instant.now();
            Instant last = lastDelivered.get(key);
            if (last != null && Duration.between(last, now).toMinutes() < cooldownMinutes) {
                log.debug("Suppressed {} for {} — within {}min dedup window",
                        event.getType(), key, cooldownMinutes);
                return false;
            }
            lastDelivered.put(key, now);
        }

        return true;
    }
}
