package com.heatingplatform.core.user;

import com.heatingplatform.core.user.UserTenantRole;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface UserTenantRoleRepository extends JpaRepository<UserTenantRole, UUID> {

    List<UserTenantRole> findByUserId(UUID userId);

    Optional<UserTenantRole> findByUserIdAndTenantId(UUID userId, UUID tenantId);

    @Query("SELECT utr.tenant.id FROM UserTenantRole utr WHERE utr.user.id = :userId")
    List<UUID> findTenantIdsByUserId(UUID userId);

    @Query("SELECT utr.tenant.id FROM UserTenantRole utr WHERE utr.user.id = :userId AND utr.tenantRole IN :roles")
    List<UUID> findTenantIdsByUserIdAndRoles(UUID userId, List<String> roles);

    List<UserTenantRole> findByTenantId(UUID tenantId);
}
