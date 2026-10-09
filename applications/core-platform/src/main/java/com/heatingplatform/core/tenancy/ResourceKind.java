package com.heatingplatform.core.tenancy;

/**
 * A kind of resource a URL can address, together with the query that names its
 * owning tenant.
 *
 * <p>Keeping the SQL next to the kind makes the mapping auditable in one place:
 * the table below IS the answer to "how does the platform decide who owns
 * what". The statements are compile-time constants and never carry request
 * input; only the bound id parameter comes from outside.
 *
 * <p>{@link #OBJECT} covers objects, metric points, physical devices, assets,
 * sites, spaces and persons alike, because all of them are subtypes sharing
 * their UUID with a row in {@code objects} (the typed-extension-table pattern
 * of ADR-013). That is why the dominant case adds no new query shape — it is
 * the same statement {@code ObjectRepository.findTenantIdByObjectId} already
 * used.
 */
public enum ResourceKind {

    /** The path variable IS the tenant id; no lookup needed. */
    TENANT(null),

    PROJECT("SELECT tenant_id FROM projects WHERE id = ?1"),

    OBJECT("SELECT tenant_id FROM objects WHERE id = ?1"),

    DASHBOARD("SELECT p.tenant_id FROM dashboards d "
            + "JOIN projects p ON p.id = d.project_id WHERE d.id = ?1"),

    ANALYSIS_VIEW("SELECT p.tenant_id FROM analysis_views v "
            + "JOIN projects p ON p.id = v.project_id WHERE v.id = ?1"),

    /** Nullable tenant: a null row is a system template shared by everyone. */
    ANALYSIS_TEMPLATE("SELECT tenant_id FROM analysis_templates WHERE id = ?1"),

    EVENT("SELECT tenant_id FROM events WHERE id = ?1"),

    KPI_FORMULA("SELECT tenant_id FROM kpi_formulas WHERE id = ?1"),

    THRESHOLD_RULE("SELECT o.tenant_id FROM threshold_rules r "
            + "JOIN objects o ON o.id = r.metric_point_id WHERE r.id = ?1"),

    ANOMALY_RULE("SELECT tenant_id FROM anomaly_rules WHERE id = ?1"),

    DERIVED_PROPERTY("SELECT o.tenant_id FROM derived_properties d "
            + "JOIN objects o ON o.id = d.object_id WHERE d.id = ?1"),

    DASHBOARD_TEMPLATE("SELECT tenant_id FROM dashboard_templates WHERE id = ?1"),

    /** Nullable tenant: null means a system-wide default. */
    EVENT_TEMPLATE("SELECT tenant_id FROM event_templates WHERE id = ?1"),

    /** Nullable tenant: null means a system default device template. */
    DEVICE_TEMPLATE("SELECT tenant_id FROM device_templates WHERE id = ?1"),

    /** Nullable tenant: null means a system object type. */
    OBJECT_TYPE("SELECT tenant_id FROM object_types WHERE id = ?1"),

    INVITATION("SELECT tenant_id FROM invitations WHERE id = ?1"),

    LINK("SELECT o.tenant_id FROM links l "
            + "JOIN objects o ON o.id = l.source_object_id WHERE l.id = ?1");

    private final String tenantQuery;

    ResourceKind(String tenantQuery) {
        this.tenantQuery = tenantQuery;
    }

    /** Null for {@link #TENANT}, whose id needs no resolution. */
    public String tenantQuery() {
        return tenantQuery;
    }

    public boolean needsLookup() {
        return tenantQuery != null;
    }
}
