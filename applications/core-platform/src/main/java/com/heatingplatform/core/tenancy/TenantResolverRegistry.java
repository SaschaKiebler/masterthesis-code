package com.heatingplatform.core.tenancy;

import org.springframework.stereotype.Component;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Maps a request to the resources it addresses.
 *
 * <p>The key insight is to look at the <b>literal URL segment preceding the
 * path variable</b>, not at the variable's name. Variable names in this
 * codebase are inconsistent — {@code id}, {@code projectId}, {@code objectId},
 * {@code ruleId} all occur, and a bare {@code {id}} means a different entity in
 * every controller. The segment never lies: {@code /projects/{id}} is a
 * project, {@code /metric-points/{id}} is an object. Keying on the segment is
 * what makes one central table sufficient.
 *
 * <p>A nested route yields several scopes and every one of them is checked, so
 * "a project of tenant A containing a site of tenant B" is refused — something
 * no hand-written per-endpoint check in the codebase managed.
 */
@Component
public class TenantResolverRegistry {

    private static final String TENANT_QUERY_PARAM = "tenantId=";

    /**
     * URL segment to the kind of resource the following id denotes.
     *
     * <p>Everything not listed here resolves to no scope, which means "not
     * tenant-scoped by this mechanism". The build-time coverage test makes that
     * a decision rather than an oversight.
     */
    private static final Map<String, ResourceKind> SEGMENT_KINDS = Map.ofEntries(
            Map.entry("tenants", ResourceKind.TENANT),
            Map.entry("projects", ResourceKind.PROJECT),

            // All of these share their UUID with a row in `objects`.
            Map.entry("objects", ResourceKind.OBJECT),
            Map.entry("sites", ResourceKind.OBJECT),
            Map.entry("assets", ResourceKind.OBJECT),
            Map.entry("spaces", ResourceKind.OBJECT),
            Map.entry("metric-points", ResourceKind.OBJECT),
            Map.entry("persons", ResourceKind.OBJECT),

            Map.entry("dashboards", ResourceKind.DASHBOARD),
            Map.entry("dashboard-templates", ResourceKind.DASHBOARD_TEMPLATE),
            Map.entry("analysis-views", ResourceKind.ANALYSIS_VIEW),
            Map.entry("analysis-templates", ResourceKind.ANALYSIS_TEMPLATE),
            Map.entry("events", ResourceKind.EVENT),
            Map.entry("event-templates", ResourceKind.EVENT_TEMPLATE),
            Map.entry("kpi-formulas", ResourceKind.KPI_FORMULA),
            Map.entry("threshold-rules", ResourceKind.THRESHOLD_RULE),
            Map.entry("anomaly-rules", ResourceKind.ANOMALY_RULE),
            Map.entry("derived-properties", ResourceKind.DERIVED_PROPERTY),
            Map.entry("device-templates", ResourceKind.DEVICE_TEMPLATE),
            Map.entry("object-types", ResourceKind.OBJECT_TYPE),
            Map.entry("invitations", ResourceKind.INVITATION),
            Map.entry("links", ResourceKind.LINK));

    /** One addressed resource, before its tenant has been looked up. */
    public record AddressedResource(ResourceKind kind, UUID resourceId) {
    }

    /**
     * Every tenant-scoped resource this URI addresses, in path order.
     *
     * @param uri          the request URI
     * @param pathVariables the values Spring extracted from the route
     */
    public List<AddressedResource> resourcesIn(String uri, Map<String, String> pathVariables) {
        List<AddressedResource> resources = new ArrayList<>();
        if (uri == null || pathVariables == null || pathVariables.isEmpty()) {
            return resources;
        }

        // Only values that Spring bound as path variables are considered, so a
        // literal segment that happens to look like a UUID is never mistaken
        // for a resource id.
        List<String> variableValues = pathVariables.values().stream().toList();
        String[] segments = uri.split("/");

        for (int i = 1; i < segments.length; i++) {
            String segment = segments[i];
            if (!variableValues.contains(segment)) {
                continue;
            }
            ResourceKind kind = SEGMENT_KINDS.get(segments[i - 1]);
            if (kind == null) {
                continue;
            }
            UUID resourceId = parseUuidOrNull(segment);
            if (resourceId != null) {
                resources.add(new AddressedResource(kind, resourceId));
            }
        }
        return resources;
    }

    /**
     * A tenant named directly in the query string.
     *
     * <p>Parsed by hand rather than through {@code getParameter}, which would
     * consume a form-encoded request body and leave the controller with nothing
     * to read. Shared with the audit filter so there is exactly one parser.
     */
    public UUID tenantFromQueryString(String queryString) {
        if (queryString == null) {
            return null;
        }
        for (String pair : queryString.split("&")) {
            if (!pair.startsWith(TENANT_QUERY_PARAM)) {
                continue;
            }
            String raw = URLDecoder.decode(pair.substring(TENANT_QUERY_PARAM.length()),
                    StandardCharsets.UTF_8);
            return parseUuidOrNull(raw);
        }
        return null;
    }

    /** Whether this URL segment introduces a tenant-scoped id. */
    public boolean isKnownSegment(String segment) {
        return SEGMENT_KINDS.containsKey(segment);
    }

    private UUID parseUuidOrNull(String raw) {
        try {
            return UUID.fromString(raw);
        } catch (IllegalArgumentException e) {
            // Not a resource id: a name, a token, a sub-route.
            return null;
        }
    }
}
