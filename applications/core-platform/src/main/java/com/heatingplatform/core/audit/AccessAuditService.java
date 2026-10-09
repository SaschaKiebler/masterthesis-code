package com.heatingplatform.core.audit;

import com.heatingplatform.core.tenancy.TenantMembershipService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/**
 * Decides whether an access attempt was cross-tenant and records it.
 *
 * Kept apart from the filter so it can be tested without a servlet container.
 * The membership question itself lives in {@link TenantMembershipService},
 * shared with the enforcement path — one definition and one cache serve both,
 * so the trail can never disagree with the decision it is recording.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AccessAuditService {

    private final TenantMembershipService membershipService;
    private final AccessAuditRepository accessAuditRepository;

    /**
     * True when this subject may not access the given tenant, and the attempt is
     * therefore worth recording.
     */
    public boolean isCrossTenant(String subject, UUID requestedTenant) {
        if (subject == null || requestedTenant == null) {
            return false;
        }
        return !membershipService.forSubject(subject).covers(requestedTenant);
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
            entry.setUserId(subject == null ? null : membershipService.forSubject(subject).userId());
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
}
