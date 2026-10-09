package com.heatingplatform.core.derivedproperty;

import com.heatingplatform.core.derivedproperty.DerivedProperty;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface DerivedPropertyRepository extends JpaRepository<DerivedProperty, UUID> {

    // Current values only (valid_until IS NULL = not yet superseded)
    List<DerivedProperty> findByObjectIdAndValidUntilIsNull(UUID objectId);

    List<DerivedProperty> findByObjectIdAndPropertyNameAndValidUntilIsNull(UUID objectId,
                                                                          String propertyName);

    List<DerivedProperty> findByPropertyNameAndTenantIdAndValidUntilIsNull(String propertyName,
                                                                            UUID tenantId);

    List<DerivedProperty> findByTenantIdAndValidUntilIsNull(UUID tenantId);

    // All historical values for a given object+property (for audit/trend)
    List<DerivedProperty> findByObjectIdAndPropertyNameOrderByValidFromDesc(UUID objectId,
                                                                             String propertyName);

    // Time-range scoped history for time series charts
    @Query(value = """
        SELECT dp.*
        FROM derived_properties dp
        WHERE dp.object_id = :objectId
          AND dp.property_name = :propertyName
          AND dp.valid_from >= to_timestamp(:fromEpoch)
          AND dp.valid_from <= to_timestamp(:toEpoch)
        ORDER BY dp.valid_from ASC
        """, nativeQuery = true)
    List<DerivedProperty> findHistoryInRange(
        @Param("objectId") UUID objectId,
        @Param("propertyName") String propertyName,
        @Param("fromEpoch") long fromEpochSeconds,
        @Param("toEpoch") long toEpochSeconds);

    // Quality monitoring: stale or low-confidence current values
    @Query("SELECT dp FROM DerivedProperty dp WHERE dp.quality != 'GOOD' AND dp.validUntil IS NULL AND dp.tenantId = :tenantId")
    List<DerivedProperty> findDegradedByTenant(@Param("tenantId") UUID tenantId);

    // Cross-object queries by property name and object type (for dashboards)
    @Query(value = """
        SELECT dp.*
        FROM derived_properties dp
        JOIN objects o ON dp.object_id = o.id
        JOIN object_types ot ON o.object_type_id = ot.id
        WHERE dp.property_name = :propertyName
          AND ot.name = ANY(:objectTypeNames)
          AND dp.tenant_id = :tenantId
          AND dp.valid_until IS NULL
        ORDER BY dp.value_numeric DESC NULLS LAST
        """, nativeQuery = true)
    List<DerivedProperty> findCurrentByPropertyAndObjectTypes(
        @Param("propertyName") String propertyName,
        @Param("objectTypeNames") String[] objectTypeNames,
        @Param("tenantId") UUID tenantId);
}
