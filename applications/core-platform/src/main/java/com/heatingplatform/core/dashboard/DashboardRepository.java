package com.heatingplatform.core.dashboard;

import com.heatingplatform.core.dashboard.Dashboard;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface DashboardRepository extends JpaRepository<Dashboard, UUID> {
    List<Dashboard> findByProjectIdOrderBySortOrderAsc(UUID projectId);
}
