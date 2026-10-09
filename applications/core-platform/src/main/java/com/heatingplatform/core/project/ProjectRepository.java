package com.heatingplatform.core.project;

import com.heatingplatform.core.project.Project;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface ProjectRepository extends JpaRepository<Project, UUID> {

    List<Project> findByTenantIdOrderByNameAsc(UUID tenantId);

    @Query("SELECT p FROM Project p WHERE p.tenant.id IN :tenantIds ORDER BY p.name ASC")
    List<Project> findByTenantIdInOrderByNameAsc(@Param("tenantIds") List<UUID> tenantIds);

    List<Project> findAllByOrderByNameAsc();

    long countByTenantId(UUID tenantId);
}
