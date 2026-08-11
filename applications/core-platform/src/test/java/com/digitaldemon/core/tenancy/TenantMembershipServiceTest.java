package com.digitaldemon.core.tenancy;

import com.digitaldemon.core.user.GlobalRole;
import com.digitaldemon.core.user.User;
import com.digitaldemon.core.user.UserRepository;
import com.digitaldemon.core.user.UserTenantRoleRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

/**
 * The membership snapshot, including the regression that motivated extracting
 * this class: an empty tenant set must not mean the same thing for a system
 * admin as for an unknown subject.
 */
@ExtendWith(MockitoExtension.class)
class TenantMembershipServiceTest {

    private static final Instant T0 = Instant.parse("2026-08-11T12:00:00Z");
    private static final String SUBJECT = "local|erika";

    @Mock
    private UserRepository userRepository;
    @Mock
    private UserTenantRoleRepository userTenantRoleRepository;

    /** Mutable clock so TTL expiry is testable without sleeping. */
    private Instant now;
    private TenantMembershipService service;

    private final UUID userId = UUID.randomUUID();
    private final UUID ownTenant = UUID.randomUUID();
    private final UUID foreignTenant = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        now = T0;
        Clock movable = new Clock() {
            @Override
            public java.time.ZoneId getZone() {
                return ZoneOffset.UTC;
            }

            @Override
            public Clock withZone(java.time.ZoneId zone) {
                return this;
            }

            @Override
            public Instant instant() {
                return now;
            }
        };
        service = new TenantMembershipService(userRepository, userTenantRoleRepository, movable);
    }

    private User user(GlobalRole role) {
        User user = new User();
        user.setId(userId);
        user.setSubject(SUBJECT);
        user.setGlobalRoleEnum(role);
        return user;
    }

    @Test
    void a_member_covers_its_own_tenant_only() {
        given(userRepository.findBySubject(SUBJECT)).willReturn(Optional.of(user(GlobalRole.VIEWER)));
        given(userTenantRoleRepository.findTenantIdsByUserId(userId)).willReturn(List.of(ownTenant));

        Membership membership = service.forSubject(SUBJECT);

        assertThat(membership.unlimited()).isFalse();
        assertThat(membership.covers(ownTenant)).isTrue();
        assertThat(membership.covers(foreignTenant)).isFalse();
        assertThat(membership.userId()).isEqualTo(userId);
    }

    /**
     * The sentinel regression. A system admin has an EMPTY tenant set and must
     * still cover every tenant — the case the older list-based helper gets
     * wrong, because it returns the same empty list for "nothing".
     */
    @Test
    void a_system_admin_covers_every_tenant_despite_an_empty_tenant_set() {
        given(userRepository.findBySubject(SUBJECT))
                .willReturn(Optional.of(user(GlobalRole.SYSTEM_ADMIN)));

        Membership membership = service.forSubject(SUBJECT);

        assertThat(membership.unlimited()).isTrue();
        assertThat(membership.tenants()).isEmpty();
        assertThat(membership.covers(foreignTenant)).isTrue();
        assertThat(membership.covers(UUID.randomUUID())).isTrue();
        // The admin case must not cost a membership query.
        verifyNoInteractions(userTenantRoleRepository);
    }

    /** The opposite pole of the same empty set: an unknown subject covers nothing. */
    @Test
    void an_unknown_subject_covers_nothing() {
        given(userRepository.findBySubject(SUBJECT)).willReturn(Optional.empty());

        Membership membership = service.forSubject(SUBJECT);

        assertThat(membership.unlimited()).isFalse();
        assertThat(membership.tenants()).isEmpty();
        assertThat(membership.covers(foreignTenant)).isFalse();
        assertThat(membership.userId()).isNull();
    }

    @Test
    void a_null_subject_covers_nothing_and_asks_no_repository() {
        Membership membership = service.forSubject(null);

        assertThat(membership.covers(ownTenant)).isFalse();
        verifyNoInteractions(userRepository, userTenantRoleRepository);
    }

    @Test
    void a_second_call_within_the_ttl_is_served_from_the_cache() {
        given(userRepository.findBySubject(SUBJECT)).willReturn(Optional.of(user(GlobalRole.VIEWER)));
        given(userTenantRoleRepository.findTenantIdsByUserId(userId)).willReturn(List.of(ownTenant));

        service.forSubject(SUBJECT);
        now = now.plus(Duration.ofMillis(TenantMembershipService.MEMBERSHIP_TTL_MILLIS - 1));
        service.forSubject(SUBJECT);

        verify(userRepository, times(1)).findBySubject(SUBJECT);
    }

    @Test
    void the_snapshot_is_re_read_once_the_ttl_has_passed() {
        given(userRepository.findBySubject(SUBJECT)).willReturn(Optional.of(user(GlobalRole.VIEWER)));
        given(userTenantRoleRepository.findTenantIdsByUserId(userId)).willReturn(List.of(ownTenant));

        service.forSubject(SUBJECT);
        now = now.plus(Duration.ofMillis(TenantMembershipService.MEMBERSHIP_TTL_MILLIS + 1));
        service.forSubject(SUBJECT);

        verify(userRepository, times(2)).findBySubject(SUBJECT);
    }
}
