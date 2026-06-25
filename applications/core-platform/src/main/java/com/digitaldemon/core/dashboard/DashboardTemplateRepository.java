package com.digitaldemon.core.dashboard;

import com.digitaldemon.core.dashboard.DashboardTemplate;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface DashboardTemplateRepository extends JpaRepository<DashboardTemplate, UUID> {

    List<DashboardTemplate> findByTenantIdOrderByCreatedAtDesc(UUID tenantId);

    List<DashboardTemplate> findAllByOrderByCreatedAtDesc();
}
