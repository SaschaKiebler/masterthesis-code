package com.heatingplatform.core.tenancy;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.mvc.method.RequestMappingInfo;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Every API route with a path variable must be classified.
 *
 * <p>This is what makes the tenancy mechanism central rather than "one more
 * place to forget". At runtime an unclassified route is simply allowed, so
 * nothing regresses silently; completeness is instead enforced here, at build
 * time. When handler number 145 is added, this test tells its author to decide
 * whether it is tenant-scoped — the decision that was skipped 17 times in
 * {@code ProjectController} before this existed.
 *
 * <p>Three ways to satisfy it: the {@link TenantResolverRegistry} knows the URL
 * segment, the handler carries {@link TenantUnscoped} with a reason, or the
 * variable is a known non-resource segment.
 */
@SpringBootTest(properties = {
        "kafka.enabled=false",
        "grpc.server.port=0",
})
@Testcontainers
class TenantScopeCoverageTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16");

    private static final Pattern PATH_VARIABLE = Pattern.compile("\\{([^}/]+)}");

    /**
     * Path variables that never denote a tenant-scoped resource.
     *
     * <p>Each entry is a decision, not an omission: these identify a person, a
     * one-time token or a sub-resource whose parent is already checked.
     */
    private static final Set<String> NON_RESOURCE_SEGMENTS = Set.of(
            "users",          // platform users are global records; UserController checks admin/self
            "by-token",       // invitation token, deliberately reachable without an identity
            "members",        // sub-resource of /tenants/{id}, whose tenant is checked already
            "privacy",        // PrivacyController runs its own manager/admin check per subject
            "physical-quantities", // shared vocabulary, no tenant
            "link-types");    // shared vocabulary, no tenant

    /** Qualified: the actuator contributes a second mapping of the same type. */
    @Autowired
    @Qualifier("requestMappingHandlerMapping")
    private RequestMappingHandlerMapping handlerMapping;

    @Autowired
    private TenantResolverRegistry registry;

    @Autowired
    private TenantOwnershipLookup ownershipLookup;

    @PersistenceContext
    private EntityManager entityManager;

    @Test
    void every_api_route_with_a_path_variable_is_classified() {
        List<String> unclassified = new ArrayList<>();

        for (Map.Entry<RequestMappingInfo, HandlerMethod> entry
                : handlerMapping.getHandlerMethods().entrySet()) {

            HandlerMethod method = entry.getValue();
            if (isUnscoped(method)) {
                continue;
            }

            for (String pattern : patternsOf(entry.getKey())) {
                if (!pattern.startsWith("/api/v1/")) {
                    continue;
                }
                unclassified.addAll(unclassifiedVariablesIn(pattern, method));
            }
        }

        assertThat(unclassified)
                .as("Routes with an unclassified path variable. Either add the URL "
                        + "segment to TenantResolverRegistry, or annotate the handler "
                        + "with @TenantUnscoped(reason = \"...\").")
                .isEmpty();
    }

    /** Each resolver statement must actually run against the real schema. */
    @Test
    void every_resource_kind_statement_is_valid_sql() {
        List<String> broken = new ArrayList<>();

        for (Map.Entry<ResourceKind, String> statement : ownershipLookup.statements().entrySet()) {
            try {
                entityManager.createNativeQuery(statement.getValue())
                        .setParameter(1, UUID.randomUUID())
                        .getResultList();
            } catch (RuntimeException e) {
                broken.add(statement.getKey() + ": " + e.getMessage());
            }
        }

        assertThat(broken)
                .as("ResourceKind statements that do not run against the schema")
                .isEmpty();
    }

    /** A reason on @TenantUnscoped must say something. */
    @Test
    void every_unscoped_handler_states_a_reason() {
        List<String> blank = new ArrayList<>();

        for (HandlerMethod method : handlerMapping.getHandlerMethods().values()) {
            TenantUnscoped annotation = unscopedAnnotation(method);
            if (annotation != null && annotation.reason().isBlank()) {
                blank.add(method.getBeanType().getSimpleName() + "." + method.getMethod().getName());
            }
        }

        assertThat(blank).as("@TenantUnscoped without a reason").isEmpty();
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private List<String> unclassifiedVariablesIn(String pattern, HandlerMethod method) {
        List<String> unclassified = new ArrayList<>();
        String[] segments = pattern.split("/");

        Matcher matcher = PATH_VARIABLE.matcher(pattern);
        while (matcher.find()) {
            String variable = matcher.group();
            int index = indexOf(segments, variable);
            if (index <= 0) {
                continue;
            }
            String preceding = segments[index - 1];
            if (registry.isKnownSegment(preceding) || NON_RESOURCE_SEGMENTS.contains(preceding)) {
                continue;
            }
            unclassified.add(pattern + " (variable " + variable + " after '" + preceding
                    + "') in " + method.getBeanType().getSimpleName() + "."
                    + method.getMethod().getName());
        }
        return unclassified;
    }

    private int indexOf(String[] segments, String value) {
        for (int i = 0; i < segments.length; i++) {
            if (segments[i].equals(value)) {
                return i;
            }
        }
        return -1;
    }

    private List<String> patternsOf(RequestMappingInfo info) {
        if (info.getPathPatternsCondition() != null) {
            return info.getPathPatternsCondition().getPatterns().stream()
                    .map(Object::toString).toList();
        }
        return List.of();
    }

    private boolean isUnscoped(HandlerMethod method) {
        return unscopedAnnotation(method) != null;
    }

    private TenantUnscoped unscopedAnnotation(HandlerMethod method) {
        TenantUnscoped onMethod = method.getMethodAnnotation(TenantUnscoped.class);
        return onMethod != null ? onMethod : method.getBeanType().getAnnotation(TenantUnscoped.class);
    }

    /** Keeps the unused import honest if Spring ever changes the mapping API. */
    @SuppressWarnings("unused")
    private static final Class<?> REQUEST_MAPPING = RequestMapping.class;
}
