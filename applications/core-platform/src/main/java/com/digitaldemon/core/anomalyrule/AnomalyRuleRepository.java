package com.digitaldemon.core.anomalyrule;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface AnomalyRuleRepository extends JpaRepository<AnomalyRule, UUID> {

    List<AnomalyRule> findByTenantId(UUID tenantId);
}
