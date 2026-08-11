package com.digitaldemon.core.tenancy;

import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Route to resource mapping. The case that matters most is "same {@code {id}},
 * different kind" — the reason the registry keys on the URL segment instead of
 * the variable name.
 */
class TenantResolverRegistryTest {

    private static final UUID A = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID B = UUID.fromString("22222222-2222-2222-2222-222222222222");

    private final TenantResolverRegistry registry = new TenantResolverRegistry();

    private Map<String, String> vars(String... keyValue) {
        Map<String, String> map = new LinkedHashMap<>();
        for (int i = 0; i < keyValue.length; i += 2) {
            map.put(keyValue[i], keyValue[i + 1]);
        }
        return map;
    }

    @Test
    void a_project_id_resolves_to_the_project_kind() {
        List<TenantResolverRegistry.AddressedResource> found =
                registry.resourcesIn("/api/v1/projects/" + A, vars("id", A.toString()));

        assertThat(found).singleElement().satisfies(r -> {
            assertThat(r.kind()).isEqualTo(ResourceKind.PROJECT);
            assertThat(r.resourceId()).isEqualTo(A);
        });
    }

    /** Identical variable name, different entity — decided by the segment. */
    @Test
    void the_same_variable_name_under_metric_points_resolves_to_an_object() {
        List<TenantResolverRegistry.AddressedResource> found =
                registry.resourcesIn("/api/v1/metric-points/" + A, vars("id", A.toString()));

        assertThat(found).singleElement()
                .satisfies(r -> assertThat(r.kind()).isEqualTo(ResourceKind.OBJECT));
    }

    @Test
    void a_nested_route_yields_every_addressed_resource_in_path_order() {
        List<TenantResolverRegistry.AddressedResource> found = registry.resourcesIn(
                "/api/v1/sites/" + A + "/spaces/" + B,
                vars("siteId", A.toString(), "spaceId", B.toString()));

        assertThat(found).hasSize(2);
        assertThat(found.get(0).resourceId()).isEqualTo(A);
        assertThat(found.get(1).resourceId()).isEqualTo(B);
        assertThat(found).allSatisfy(r -> assertThat(r.kind()).isEqualTo(ResourceKind.OBJECT));
    }

    @Test
    void a_tenant_id_in_the_path_is_its_own_scope() {
        List<TenantResolverRegistry.AddressedResource> found =
                registry.resourcesIn("/api/v1/tenants/" + A + "/members", vars("id", A.toString()));

        assertThat(found).singleElement()
                .satisfies(r -> assertThat(r.kind()).isEqualTo(ResourceKind.TENANT));
    }

    @Test
    void an_unknown_segment_yields_no_scope() {
        List<TenantResolverRegistry.AddressedResource> found =
                registry.resourcesIn("/api/v1/users/" + A, vars("id", A.toString()));

        assertThat(found).isEmpty();
    }

    /** A non-UUID path variable (an invitation token) is not a resource id. */
    @Test
    void a_non_uuid_path_variable_yields_no_scope() {
        List<TenantResolverRegistry.AddressedResource> found = registry.resourcesIn(
                "/api/v1/invitations/by-token/abc123", vars("token", "abc123"));

        assertThat(found).isEmpty();
    }

    /**
     * A literal segment that happens to look like a UUID must not be read as a
     * resource id — only values Spring actually bound are considered.
     */
    @Test
    void a_uuid_that_is_not_a_path_variable_is_ignored() {
        List<TenantResolverRegistry.AddressedResource> found =
                registry.resourcesIn("/api/v1/projects/" + A, Map.of());

        assertThat(found).isEmpty();
    }

    @Test
    void the_tenant_query_parameter_is_parsed() {
        assertThat(registry.tenantFromQueryString("limit=50&tenantId=" + A + "&sort=name"))
                .isEqualTo(A);
        assertThat(registry.tenantFromQueryString("limit=50")).isNull();
        assertThat(registry.tenantFromQueryString("tenantId=not-a-uuid")).isNull();
        assertThat(registry.tenantFromQueryString(null)).isNull();
    }
}
