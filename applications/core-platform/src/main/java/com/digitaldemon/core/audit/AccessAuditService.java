package com.digitaldemon.core.audit;

import com.digitaldemon.core.user.GlobalRole;
import com.digitaldemon.core.user.User;
import com.digitaldemon.core.user.UserRepository;
import com.digitaldemon.core.user.UserTenantRoleRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Decides whether an access attempt was cross-tenant and records it.
 *
 * Kept apart from the filter so the membership lookup can be cached and tested
 * without a servlet container.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AccessAuditService {

    /**
     * How long a caller's tenant membership is reused before it is read again.
     *
     * Without this, every audited request costs an extra database round trip,
     * which would show up in the QS-PER-03 response times and make the audit
     * trail pay for itself out of the numbers it is supposed to sit beside.
     * Membership changes rarely, so a few seconds of staleness is acceptable;
     * a stale entry can at worst mislabel an attempt for that window, never
     * grant access, because the filter does not authorise anything.
     */
    private static final long MEMBERSHIP_TTL_MILLIS = 5_000;

    private final UserRepository userRepository;
    private final UserTenantRoleRepository userTenantRoleRepository;
    private final AccessAuditRepository accessAuditRepository;

    private final ConcurrentHashMap<String, Membership> membershipCache = new ConcurrentHashMap<>();

    /**
     * Membership snapshot for one subject.
     *
     * @param userId   resolved platform user, null when the subject has none
     * @param tenants  tenants the user belongs to
     * @param unlimited true for system admins, who are never cross-tenant
     * @param readAtMillis when this snapshot was taken
     */
    private record Membership(UUID userId, Set<UUID> tenants, boolean unlimited, long readAtMillis) {

        boolean isFresh(long nowMillis) {
            return nowMillis - readAtMillis < MEMBERSHIP_TTL_MILLIS;
        }

        boolean covers(UUID tenantId) {
            return unlimited || tenants.contains(tenantId);
        }
    }

    /**
     * True when this subject may not access the given tenant, and the attempt is
     * therefore worth recording.
     */
    public boolean isCrossTenant(String subject, UUID requestedTenant) {
        if (subject == null || requestedTenant == null) {
            return false;
        }
        return !membership(subject).covers(requestedTenant);
    }

    /**
     * Write one audit row.
     *
     * Runs in its own transaction so a rolled-back request still leaves its
     * trace, and never propagates a failure: an audit trail that can break the
     * API it observes would be worse than the gap it closes.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void record(String subject, UUID requestedTenant, String method, String path,
                       int httpStatus, AccessOutcome outcome) {
        try {
            AccessAudit entry = new AccessAudit();
            entry.setSubject(subject);
            entry.setUserId(subject == null ? null : membership(subject).userId());
            entry.setRequestedTenant(requestedTenant);
            entry.setMethod(method);
            entry.setPath(path);
            entry.setHttpStatus(httpStatus);
            entry.setOutcome(outcome);
            accessAuditRepository.save(entry);
        } catch (RuntimeException e) {
            log.warn("Could not write access audit entry for {} {} ({}): {}",
                    method, path, outcome, e.toString());
        }
    }

    private Membership membership(String subject) {
        long now = System.currentTimeMillis();

        Membership cached = membershipCache.get(subject);
        if (cached != null && cached.isFresh(now)) {
            return cached;
        }

        Membership fresh = readMembership(subject, now);
        membershipCache.put(subject, fresh);
        return fresh;
    }

    private Membership readMembership(String subject, long now) {
        Optional<User> user = userRepository.findBySubject(subject);
        if (user.isEmpty()) {
            // Unknown subject: it belongs to no tenant, so every named tenant is
            // foreign to it and every attempt gets recorded.
            return new Membership(null, Set.of(), false, now);
        }

        User found = user.get();
        if (found.getGlobalRoleEnum() == GlobalRole.SYSTEM_ADMIN) {
            return new Membership(found.getId(), Set.of(), true, now);
        }

        List<UUID> tenants = userTenantRoleRepository.findTenantIdsByUserId(found.getId());
        return new Membership(found.getId(), Set.copyOf(tenants), false, now);
    }
}
