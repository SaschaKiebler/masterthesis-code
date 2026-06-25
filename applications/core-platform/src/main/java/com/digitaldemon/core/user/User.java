package com.digitaldemon.core.user;

import jakarta.persistence.*;
import lombok.Data;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "users")
@Data
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "auth0_sub", unique = true, nullable = false)
    private String auth0Sub;

    @Column
    private String email;

    @Column(name = "display_name")
    private String displayName;

    @Column(name = "avatar_url")
    private String avatarUrl;

    @Column(name = "global_role", nullable = false)
    private String globalRole = "viewer";

    @Column(name = "last_login_at")
    private Instant lastLoginAt;

    @Column(name = "created_at")
    private Instant createdAt;

    @OneToMany(mappedBy = "user", fetch = FetchType.LAZY)
    private List<UserTenantRole> tenantRoles = new ArrayList<>();

    @Transient
    public GlobalRole getGlobalRoleEnum() {
        return GlobalRole.fromValue(this.globalRole);
    }

    public void setGlobalRoleEnum(GlobalRole role) {
        this.globalRole = role.getValue();
    }
}
