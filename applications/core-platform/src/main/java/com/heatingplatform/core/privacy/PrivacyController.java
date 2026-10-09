package com.heatingplatform.core.privacy;

import com.heatingplatform.core.user.AuthService;
import com.heatingplatform.core.user.TenantRole;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import java.util.UUID;

/**
 * GDPR endpoints (thesis QS-SEC-02): subject access (Art. 15) and erasure
 * (Art. 17) for the two data-subject categories the platform stores —
 * residents ({@code PERSON} objects) and platform users.
 *
 * <p>Authorisation: resident requests require the manager role in the tenant
 * that owns the person; user requests are platform-wide and require the system
 * admin. Denials return an explicit 403, which the {@code AccessAuditFilter}
 * records as {@code DENIED} — a cross-tenant erasure attempt therefore lands
 * in the very audit trail QS-SEC-01 measures.
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/privacy")
@RequiredArgsConstructor
public class PrivacyController {

    private final PersonPrivacyService personPrivacyService;
    private final UserPrivacyService userPrivacyService;
    private final AuthService authService;

    // ── Residents ─────────────────────────────────────────────────────────────

    @GetMapping("/persons/{id}/export")
    public ResponseEntity<?> exportPerson(@PathVariable UUID id) {
        ResponseEntity<?> denied = requireManagerOfPersonTenant(id);
        if (denied != null) {
            return denied;
        }
        log.info("GDPR export for person {}", id);
        return ResponseEntity.ok(personPrivacyService.export(id));
    }

    @DeleteMapping("/persons/{id}")
    public ResponseEntity<?> erasePerson(@PathVariable UUID id) {
        ResponseEntity<?> denied = requireManagerOfPersonTenant(id);
        if (denied != null) {
            return denied;
        }
        log.info("GDPR erasure for person {}", id);
        return ResponseEntity.ok(personPrivacyService.erase(id));
    }

    // ── Platform users ────────────────────────────────────────────────────────

    @GetMapping("/users/{id}/export")
    public ResponseEntity<?> exportUser(@PathVariable UUID id) {
        if (!authService.isSystemAdmin()) {
            return forbidden();
        }
        log.info("GDPR export for user {}", id);
        return ResponseEntity.ok(userPrivacyService.export(id));
    }

    @DeleteMapping("/users/{id}")
    public ResponseEntity<?> eraseUser(@PathVariable UUID id) {
        if (!authService.isSystemAdmin()) {
            return forbidden();
        }
        log.info("GDPR erasure for user {}", id);
        return ResponseEntity.ok(userPrivacyService.erase(id));
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /**
     * Null when authorised; the 403 response otherwise. An unknown id yields
     * 404, a foreign one 403 — that difference does reveal whether an id
     * exists, and it is accepted deliberately: the explicit 403 is what the
     * AccessAuditFilter records as DENIED, and QS-SEC-01 values that
     * visibility over hiding id existence. Stated in the thesis, not glossed.
     */
    private ResponseEntity<?> requireManagerOfPersonTenant(UUID personId) {
        UUID tenantId = personPrivacyService.tenantOf(personId);
        if (tenantId == null) {
            // Tenant-less (system) objects are nobody's data subject.
            return authService.isSystemAdmin() ? null : forbidden();
        }
        return authService.hasRoleInTenant(tenantId, TenantRole.MANAGER) ? null : forbidden();
    }

    private ResponseEntity<Map<String, String>> forbidden() {
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(Map.of("message", "Insufficient permissions for privacy operations"));
    }
}
