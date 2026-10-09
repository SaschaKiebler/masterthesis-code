package com.heatingplatform.core.tenancy;

import com.heatingplatform.core.user.GlobalRole;
import com.heatingplatform.core.user.User;
import com.heatingplatform.core.user.UserRepository;
import com.heatingplatform.core.user.UserTenantRoleRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The single answer to "which tenants may this caller see", cached.
 *
 * <p>Both consumers use it: {@code TenantScopeInterceptor} to decide access and
 * {@code AccessAuditService} to decide whether an attempt was cross-tenant. One
 * definition, one cache — before this class the audit trail carried a private
 * copy, and the rest of the codebase used a differently-behaving helper on
 * {@code AuthService}.
 *
 * <p>The cache is what keeps enforcement affordable: without it every guarded
 * request costs two database round trips, which would land in the QS-PER-03
 * response times. Membership rarely changes, so a few seconds of staleness is
 * an acceptable trade; the window is bounded and stated rather than hidden.
 */
@Service
@RequiredArgsConstructor
public class TenantMembershipService {

    /** Bounded staleness of a membership snapshot; also the revocation window. */
    static final long MEMBERSHIP_TTL_MILLIS = 5_000;

    private final UserRepository userRepository;
    private final UserTenantRoleRepository userTenantRoleRepository;
    private final Clock clock;

    private final ConcurrentHashMap<String, Membership> cache = new ConcurrentHashMap<>();

    public Membership forSubject(String subject) {
        if (subject == null) {
            return Membership.none(clock.millis());
        }

        long now = clock.millis();
        Membership cached = cache.get(subject);
        if (cached != null && cached.isFresh(now, MEMBERSHIP_TTL_MILLIS)) {
            return cached;
        }

        Membership fresh = read(subject, now);
        cache.put(subject, fresh);
        return fresh;
    }

    private Membership read(String subject, long now) {
        Optional<User> user = userRepository.findBySubject(subject);
        if (user.isEmpty()) {
            return Membership.none(now);
        }

        User found = user.get();
        if (found.getGlobalRoleEnum() == GlobalRole.SYSTEM_ADMIN) {
            return new Membership(found.getId(), Set.of(), true, now);
        }

        List<UUID> tenants = userTenantRoleRepository.findTenantIdsByUserId(found.getId());
        return new Membership(found.getId(), Set.copyOf(tenants), false, now);
    }
}
