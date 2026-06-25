package com.digitaldemon.core.dashboard;

import com.digitaldemon.core.tenant.Tenant;

import jakarta.persistence.*;
import lombok.Data;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.UUID;

/**
 * A saved dashboard layout that tenants can reuse across projects.
 *
 * <p>Tenant isolation is enforced via the {@code tenant_id} foreign key.
 * All queries against this table must be scoped by tenant ID.</p>
 */
@Entity
@Table(name = "dashboard_templates")
@Data
public class DashboardTemplate {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "tenant_id", nullable = false)
    private Tenant tenant;

    @Column(nullable = false)
    private String name;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb", nullable = false)
    private String layout = "{}";

    @Column(name = "created_at")
    private Instant createdAt;
}
