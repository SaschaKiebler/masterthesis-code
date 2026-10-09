package com.heatingplatform.core.kpiformula;

import com.heatingplatform.core.kpiformula.KpiFormula;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

/**
 * Repository for KpiFormula entities.
 *
 * Supports lookup by the anchor object (for CRUD on individual object pages)
 * and by tenant + enabled flag (for the MQTT-triggered batch evaluator).
 */
@Repository
public interface KpiFormulaRepository extends JpaRepository<KpiFormula, UUID> {

    /**
     * Find all formulas attached to a given ontology object.
     * Used by the KPI Builder UI to display formulas for a selected object.
     */
    List<KpiFormula> findByObjectId(UUID objectId);

    /**
     * Find all enabled formulas for a tenant.
     * Used by KpiFormulaEvaluator to load the active formula set during MQTT batch evaluation.
     */
    List<KpiFormula> findByTenantIdAndEnabledTrue(UUID tenantId);

    /**
     * Find all enabled formulas across all tenants.
     * Used by KpiFormulaScheduler for periodic background evaluation.
     */
    List<KpiFormula> findByEnabledTrue();
}
