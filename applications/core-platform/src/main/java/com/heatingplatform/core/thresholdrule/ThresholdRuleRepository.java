package com.heatingplatform.core.thresholdrule;

import com.heatingplatform.core.thresholdrule.ThresholdRule;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface ThresholdRuleRepository extends JpaRepository<ThresholdRule, UUID> {

    /** All enabled rules for a specific metric point — called on every incoming measurement. */
    List<ThresholdRule> findByMetricPointIdAndEnabledTrue(UUID metricPointId);

    List<ThresholdRule> findByTenantId(UUID tenantId);

    List<ThresholdRule> findByMetricPointId(UUID metricPointId);
}
