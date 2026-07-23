package com.digitaldemon.notification.api;

import com.digitaldemon.notification.auth.TenantResolver;
import com.digitaldemon.notification.persistence.Notification;
import com.digitaldemon.notification.persistence.NotificationRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Meldungen of the caller's tenant, newest first; acknowledge sets the flag. */
@RestController
@RequestMapping("/api/v1/notifications")
@RequiredArgsConstructor
public class NotificationController {

    private final NotificationRepository notificationRepository;
    private final TenantResolver tenantResolver;

    @GetMapping
    public List<Notification> list(
            @RequestParam(required = false) UUID tenantId,
            @RequestParam(required = false) Instant since,
            @RequestParam(required = false) String severity,
            @RequestParam(required = false) Boolean acknowledged,
            @RequestParam(defaultValue = "50") int limit,
            @RequestParam(defaultValue = "0") int offset) {
        UUID tenant = tenantResolver.resolveTenant(tenantId);
        int effectiveLimit = Math.min(Math.max(limit, 1), 500);
        return notificationRepository.query(tenant, since,
                severity == null ? null : severity.toUpperCase(),
                acknowledged, effectiveLimit, Math.max(offset, 0));
    }

    @PatchMapping("/{id}/ack")
    public Notification acknowledge(@PathVariable UUID id,
                                    @RequestParam(required = false) UUID tenantId) {
        UUID tenant = tenantResolver.resolveTenant(tenantId);
        return notificationRepository.acknowledge(id, tenant, tenantResolver.currentSubject())
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND, "Notification not found"));
    }
}
