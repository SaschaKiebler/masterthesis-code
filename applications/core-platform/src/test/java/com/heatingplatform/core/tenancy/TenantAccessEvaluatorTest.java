package com.heatingplatform.core.tenancy;

import com.heatingplatform.core.site.SiteAssignmentRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.verifyNoInteractions;

/**
 * The decision table, executed.
 *
 * <p>The {@code @CsvSource} rows are the same rows as the policy table in the
 * thesis and in {@link TenantAccessEvaluator}'s Javadoc — deliberately, so a
 * change to the policy cannot land without the documentation moving with it.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class TenantAccessEvaluatorTest {

    private static final UUID OWN_TENANT = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID FOREIGN_TENANT = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID USER_ID = UUID.fromString("33333333-3333-3333-3333-333333333333");
    private static final UUID RESOURCE_ID = UUID.fromString("44444444-4444-4444-4444-444444444444");

    @Mock
    private SiteAssignmentRepository siteAssignmentRepository;

    private TenantAccessEvaluator evaluator() {
        return new TenantAccessEvaluator(siteAssignmentRepository);
    }

    private Membership member() {
        return new Membership(USER_ID, Set.of(OWN_TENANT), false, 0L);
    }

    private Membership admin() {
        return new Membership(USER_ID, Set.of(), true, 0L);
    }

    private Membership stranger() {
        return Membership.none(0L);
    }

    @ParameterizedTest(name = "{0} + {1} + {2} -> {3}")
    @CsvSource({
            // membership, resolution, method, expected
            "ADMIN,    RESOLVED_FOREIGN, GET,    ALLOW",
            "ADMIN,    RESOLVED_FOREIGN, DELETE, ALLOW",
            "ADMIN,    GLOBAL,           POST,   ALLOW",
            "MEMBER,   RESOLVED_OWN,     GET,    ALLOW",
            "MEMBER,   RESOLVED_OWN,     DELETE, ALLOW",
            "MEMBER,   RESOLVED_FOREIGN, GET,    DENY",
            "MEMBER,   RESOLVED_FOREIGN, POST,   DENY",
            "STRANGER, RESOLVED_OWN,     GET,    DENY",
            "MEMBER,   GLOBAL,           GET,    ALLOW",
            "MEMBER,   GLOBAL,           HEAD,   ALLOW",
            "MEMBER,   GLOBAL,           POST,   DENY",
            "MEMBER,   GLOBAL,           PATCH,  DENY",
            "MEMBER,   GLOBAL,           DELETE, DENY",
            "MEMBER,   UNKNOWN,          GET,    ALLOW",
            "MEMBER,   UNKNOWN,          DELETE, ALLOW",
            "STRANGER, UNKNOWN,          GET,    ALLOW",
    })
    void policy_table(String who, String what, String method, String expected) {
        Membership membership = switch (who) {
            case "ADMIN" -> admin();
            case "MEMBER" -> member();
            default -> stranger();
        };
        TenantScope scope = switch (what) {
            case "RESOLVED_OWN" -> TenantScope.resolved(ResourceKind.PROJECT, RESOURCE_ID, OWN_TENANT);
            case "RESOLVED_FOREIGN" -> TenantScope.resolved(ResourceKind.PROJECT, RESOURCE_ID, FOREIGN_TENANT);
            case "GLOBAL" -> TenantScope.global(ResourceKind.OBJECT_TYPE, RESOURCE_ID);
            default -> TenantScope.unknown(ResourceKind.PROJECT, RESOURCE_ID);
        };

        assertThat(evaluator().decide(membership, scope, method))
                .isEqualTo(TenantAccessEvaluator.Decision.valueOf(expected));
    }

    /** The technician fallback: assigned to an individual site of another tenant. */
    @Test
    void a_site_assignment_rescues_an_otherwise_foreign_object() {
        given(siteAssignmentRepository.existsByUserIdAndSiteId(USER_ID, RESOURCE_ID)).willReturn(true);

        TenantScope scope = TenantScope.resolved(ResourceKind.OBJECT, RESOURCE_ID, FOREIGN_TENANT);

        assertThat(evaluator().decide(member(), scope, "GET"))
                .isEqualTo(TenantAccessEvaluator.Decision.ALLOW);
    }

    /** The fallback applies to objects only, not to whole projects. */
    @Test
    void a_site_assignment_does_not_open_a_foreign_project() {
        given(siteAssignmentRepository.existsByUserIdAndSiteId(USER_ID, RESOURCE_ID)).willReturn(true);

        TenantScope scope = TenantScope.resolved(ResourceKind.PROJECT, RESOURCE_ID, FOREIGN_TENANT);

        assertThat(evaluator().decide(member(), scope, "GET"))
                .isEqualTo(TenantAccessEvaluator.Decision.DENY);
    }

    /** An admin must not cost a lookup — the hot path stays free. */
    @Test
    void an_admin_is_decided_without_touching_the_repository() {
        TenantScope scope = TenantScope.resolved(ResourceKind.OBJECT, RESOURCE_ID, FOREIGN_TENANT);

        evaluator().decide(admin(), scope, "DELETE");

        verifyNoInteractions(siteAssignmentRepository);
    }

    /** A member on its own tenant must not cost a lookup either. */
    @Test
    void the_common_case_is_decided_without_touching_the_repository() {
        TenantScope scope = TenantScope.resolved(ResourceKind.OBJECT, RESOURCE_ID, OWN_TENANT);

        evaluator().decide(member(), scope, "GET");

        verifyNoInteractions(siteAssignmentRepository);
    }
}
