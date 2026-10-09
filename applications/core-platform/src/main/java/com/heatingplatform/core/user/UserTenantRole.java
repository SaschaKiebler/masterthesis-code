package com.heatingplatform.core.user;

import com.heatingplatform.core.tenant.Tenant;

import jakarta.persistence.*;
import lombok.Data;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "user_tenant_roles")
@Data
public class UserTenantRole {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "tenant_id", nullable = false)
    private Tenant tenant;

    @Column(name = "tenant_role", nullable = false)
    private String tenantRole = "viewer";

    @Column(name = "created_at")
    private Instant createdAt;

    @Transient
    public TenantRole getTenantRoleEnum() {
        return TenantRole.fromValue(this.tenantRole);
    }

    public void setTenantRoleEnum(TenantRole role) {
        this.tenantRole = role.getValue();
    }
}
