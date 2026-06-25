package com.digitaldemon.core.metricpoint;

import com.digitaldemon.core.metricpoint.MetricPoint;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface MetricPointRepository extends JpaRepository<MetricPoint, UUID> {

    Optional<MetricPoint> findByDeviceIdAndMetricId(String deviceId, Short metricId);

    List<MetricPoint> findByDeviceId(String deviceId);

    List<MetricPoint> findByQuantityId(UUID quantityId);

    /**
     * Find all metric points linked to an asset via the HAS_METRIC link type.
     * Graph traversal: Asset --HAS_METRIC--> MetricPoint
     * Scoped to tenant via objects.tenant_id.
     */
    @Query(value = """
        SELECT mp.*
        FROM metric_points mp
        JOIN objects o ON mp.id = o.id
        JOIN links l ON l.target_object_id = mp.id
        JOIN link_types lt ON l.link_type_id = lt.id AND lt.name = 'HAS_METRIC'
        WHERE l.source_object_id = :assetId
          AND (CAST(:tenantId AS uuid) IS NULL OR o.tenant_id = :tenantId OR o.tenant_id IS NULL)
        ORDER BY mp.metric_id
        """, nativeQuery = true)
    List<MetricPoint> findByAssetIdViaHasMetric(@Param("assetId") UUID assetId,
                                                @Param("tenantId") UUID tenantId);

    /**
     * Return signal-map-compatible rows for the IDE device config panel.
     * Each row: [metric_id, name, unit, source, field, min_value, max_value]
     * Name is objects.display_name which holds the original signal map entry name
     * (e.g. "phase_a_active_power") after the V13 migration. This keeps phase-level
     * metrics distinguishable (all three phases share the same physical quantity but
     * have different original names).
     */
    @Query(value = """
        SELECT mp.metric_id,
               o.display_name AS name,
               mp.unit,
               mp.source,
               mp.field,
               mp.min_value,
               mp.max_value
        FROM   metric_points mp
        JOIN   objects     o  ON mp.id                = o.id
        JOIN   links       l  ON l.target_object_id   = mp.id
        JOIN   link_types  lt ON l.link_type_id       = lt.id AND lt.name = 'HAS_METRIC'
        WHERE  l.source_object_id = :assetId
        ORDER  BY mp.metric_id
        """, nativeQuery = true)
    List<Object[]> findSignalMapRowsByAssetId(@Param("assetId") UUID assetId);

    /**
     * Find MetricPoints linked to a specific asset via HAS_METRIC whose display name
     * (objects.display_name — original signal-map entry name) matches exactly.
     * Used as a fallback in TRAVERSE variable resolution when no physical quantity match is found.
     */
    @Query(value = """
        SELECT mp.*
        FROM metric_points mp
        JOIN objects o ON mp.id = o.id
        JOIN links l ON l.target_object_id = mp.id
        JOIN link_types lt ON l.link_type_id = lt.id AND lt.name = 'HAS_METRIC'
        WHERE l.source_object_id = :assetId
          AND o.display_name = :displayName
          AND (CAST(:tenantId AS uuid) IS NULL OR o.tenant_id = :tenantId OR o.tenant_id IS NULL)
        ORDER BY mp.metric_id
        """, nativeQuery = true)
    List<MetricPoint> findByAssetIdAndDisplayName(@Param("assetId") UUID assetId,
                                                  @Param("tenantId") UUID tenantId,
                                                  @Param("displayName") String displayName);

    /**
     * Cross-asset semantic query: all metric points measuring a given physical quantity within a tenant.
     * Graph: MetricPoint --MEASURES--> PhysicalQuantity
     */
    @Query(value = """
        SELECT mp.*
        FROM metric_points mp
        JOIN objects o ON mp.id = o.id
        JOIN physical_quantities pq ON mp.quantity_id = pq.id
        WHERE pq.name = :quantityName
          AND (CAST(:tenantId AS uuid) IS NULL OR o.tenant_id = :tenantId OR o.tenant_id IS NULL)
        ORDER BY mp.device_id, mp.metric_id
        """, nativeQuery = true)
    List<MetricPoint> findByTenantAndQuantityName(@Param("tenantId") UUID tenantId,
                                                  @Param("quantityName") String quantityName);

    /**
     * Bulk query: find all metric points linked to any of the given object IDs via HAS_METRIC,
     * enriched with asset context (name, type) and physical quantity info.
     * Returns Object[] rows:
     *   [0] mp.id (UUID), [1] mp.device_id, [2] mp.metric_id, [3] mp.source, [4] mp.field,
     *   [5] mp.unit, [6] mp.min_value, [7] mp.max_value, [8] mp.quantity_id,
     *   [9] mp.sample_interval_seconds,
     *   [10] mp_obj.display_name (metric point name),
     *   [11] asset_obj.id (asset UUID), [12] asset_obj.display_name (asset name),
     *   [13] asset_type.name (asset type),
     *   [14] pq.name (quantity name), [15] pq.display_name (quantity display name),
     *   [16] pq.dimension, [17] pq.default_unit
     */
    @Query(value = """
        SELECT mp.id, mp.device_id, mp.metric_id, mp.source, mp.field,
               mp.unit, mp.min_value, mp.max_value, mp.quantity_id,
               mp.sample_interval_seconds,
               mp_obj.display_name AS mp_display_name,
               asset_obj.id AS asset_id, asset_obj.display_name AS asset_name,
               asset_type.name AS asset_type_name,
               pq.name AS quantity_name, pq.display_name AS quantity_display_name,
               pq.dimension AS quantity_dimension, pq.default_unit AS quantity_default_unit
        FROM metric_points mp
        JOIN objects mp_obj ON mp.id = mp_obj.id
        JOIN links hm ON hm.target_object_id = mp.id
        JOIN link_types hm_lt ON hm.link_type_id = hm_lt.id AND hm_lt.name = 'HAS_METRIC'
        JOIN objects asset_obj ON hm.source_object_id = asset_obj.id
        JOIN object_types asset_type ON asset_obj.object_type_id = asset_type.id
        LEFT JOIN physical_quantities pq ON mp.quantity_id = pq.id
        WHERE asset_obj.id IN :objectIds
        ORDER BY asset_obj.display_name, mp.metric_id
        """, nativeQuery = true)
    List<Object[]> findEnrichedByObjectIds(@Param("objectIds") Collection<UUID> objectIds);
}
