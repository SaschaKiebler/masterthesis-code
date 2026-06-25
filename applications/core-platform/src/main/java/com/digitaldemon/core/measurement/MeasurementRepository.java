package com.digitaldemon.core.measurement;

import com.digitaldemon.core.measurement.MeasurementDTO;
import com.digitaldemon.core.measurement.MeasurementStatisticsDTO;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.Collection;
import java.util.Collections;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public class MeasurementRepository {
    
    @PersistenceContext
    private EntityManager entityManager;
    
    /**
     * Get aggregated measurements for an asset using TimescaleDB time_bucket.
     * 
     * @param deviceId  Device ID (factory hardware ID)
     * @param from      Start time
     * @param to        End time  
     * @param bucketMinutes  Time bucket size in minutes (e.g., 60 for 1 hour)
     * @return List of aggregated measurements
     */
    @SuppressWarnings("unchecked")
    public List<MeasurementDTO> getAggregatedMeasurements(
            String deviceId, Instant from, Instant to, int bucketMinutes,
            List<Integer> metricIds) {

        String metricFilter = (metricIds != null && !metricIds.isEmpty())
            ? "AND m.metric_id IN (:metricIds)"
            : "";

        String sql = """
            SELECT
                time_bucket(make_interval(mins => :bucketMinutes), m.time) AS bucket,
                m.device_id,
                m.metric_id,
                COALESCE(mp_obj.display_name, 'unknown') AS metric_name,
                AVG(m.value) AS avg_value
            FROM measurements m
            LEFT JOIN metric_points mp ON m.device_id = mp.device_id AND m.metric_id = mp.metric_id
            LEFT JOIN objects mp_obj ON mp.id = mp_obj.id
            WHERE m.device_id = :deviceId
              AND m.time >= :from
              AND m.time <= :to
              %s
            GROUP BY bucket, m.device_id, m.metric_id, mp_obj.display_name
            ORDER BY bucket DESC, m.metric_id
            """.formatted(metricFilter);

        var query = entityManager.createNativeQuery(sql)
            .setParameter("deviceId", deviceId)
            .setParameter("from", from)
            .setParameter("to", to)
            .setParameter("bucketMinutes", bucketMinutes);

        if (metricIds != null && !metricIds.isEmpty()) {
            query.setParameter("metricIds", metricIds);
        }

        return query.getResultStream()
            .map(row -> {
                Object[] r = (Object[]) row;
                return new MeasurementDTO(
                    parseInstant(r[0]),
                    (String) r[1],
                    ((Number) r[2]).intValue(),
                    (String) r[3],
                    ((Number) r[4]).doubleValue()
                );
            })
            .toList();
    }
    
    /**
     * Get raw (unbucketed) measurements for an asset — every individual data point.
     * Used for boolean/event-log widgets where aggregation would lose state-change precision.
     */
    @SuppressWarnings("unchecked")
    public List<MeasurementDTO> getRawMeasurements(
            String deviceId, Instant from, Instant to, List<Integer> metricIds) {

        String metricFilter = (metricIds != null && !metricIds.isEmpty())
            ? "AND m.metric_id IN (:metricIds)"
            : "";

        String sql = """
            SELECT
                m.time,
                m.device_id,
                m.metric_id,
                COALESCE(mp_obj.display_name, 'unknown') AS metric_name,
                m.value
            FROM measurements m
            LEFT JOIN metric_points mp ON m.device_id = mp.device_id AND m.metric_id = mp.metric_id
            LEFT JOIN objects mp_obj ON mp.id = mp_obj.id
            WHERE m.device_id = :deviceId
              AND m.time >= :from
              AND m.time <= :to
              %s
            ORDER BY m.time DESC
            """.formatted(metricFilter);

        var query = entityManager.createNativeQuery(sql)
            .setParameter("deviceId", deviceId)
            .setParameter("from", from)
            .setParameter("to", to);

        if (metricIds != null && !metricIds.isEmpty()) {
            query.setParameter("metricIds", metricIds);
        }

        return query.getResultStream()
            .map(row -> {
                Object[] r = (Object[]) row;
                return new MeasurementDTO(
                    parseInstant(r[0]),
                    (String) r[1],
                    ((Number) r[2]).intValue(),
                    (String) r[3],
                    ((Number) r[4]).doubleValue()
                );
            })
            .toList();
    }

    /**
     * Get aggregated measurements for ALL assets of a site using TimescaleDB time_bucket.
     * This is the core query for the consultant analysis view — returns all device+metric
     * series for a site in a single round-trip.
     *
     * @param siteId        Site UUID
     * @param from          Start time
     * @param to            End time
     * @param bucketMinutes Time bucket size in minutes
     * @return List of measurements across all assets of the site
     */
    @SuppressWarnings("unchecked")
    public List<MeasurementDTO> getSiteMeasurements(
            UUID siteId, Instant from, Instant to, int bucketMinutes) {
        
        // Recursive CTE walks the CONTAINS hierarchy from the site/building downward,
        // then finds physical devices via REALIZED_BY from any object in the subtree,
        // plus legacy INSTALLED_AT links directly on the site.
        String sql = """
            WITH RECURSIVE site_tree AS (
                SELECT CAST(:siteId AS uuid) AS obj_id
                UNION ALL
                SELECT l.target_object_id
                FROM links l
                JOIN link_types lt ON l.link_type_id = lt.id AND lt.name = 'CONTAINS'
                JOIN site_tree st ON l.source_object_id = st.obj_id
            ),
            site_devices AS (
                SELECT DISTINCT pd.device_id
                FROM physical_devices pd
                JOIN links rb ON rb.target_object_id = pd.id
                JOIN link_types rb_lt ON rb.link_type_id = rb_lt.id AND rb_lt.name = 'REALIZED_BY'
                WHERE rb.source_object_id IN (SELECT obj_id FROM site_tree)
                UNION
                SELECT pd2.device_id
                FROM physical_devices pd2
                JOIN links rb2 ON rb2.target_object_id = pd2.id
                JOIN link_types rb2_lt ON rb2.link_type_id = rb2_lt.id AND rb2_lt.name = 'REALIZED_BY'
                JOIN links ia ON ia.source_object_id = rb2.source_object_id
                JOIN link_types ia_lt ON ia.link_type_id = ia_lt.id AND ia_lt.name = 'INSTALLED_AT'
                WHERE ia.target_object_id = CAST(:siteId AS uuid)
            )
            SELECT
                time_bucket(make_interval(mins => :bucketMinutes), m.time) AS bucket,
                m.device_id,
                m.metric_id,
                COALESCE(mp_obj.display_name, 'unknown') AS metric_name,
                AVG(m.value) AS avg_value
            FROM measurements m
            LEFT JOIN metric_points mp ON m.device_id = mp.device_id AND m.metric_id = mp.metric_id
            LEFT JOIN objects mp_obj ON mp.id = mp_obj.id
            WHERE m.device_id IN (SELECT device_id FROM site_devices)
              AND m.time >= :from
              AND m.time <= :to
            GROUP BY bucket, m.device_id, m.metric_id, mp_obj.display_name
            ORDER BY bucket DESC, m.device_id, m.metric_id
            """;
        
        return entityManager.createNativeQuery(sql)
            .setParameter("siteId", siteId)
            .setParameter("from", from)
            .setParameter("to", to)
            .setParameter("bucketMinutes", bucketMinutes)
            .getResultStream()
            .map(row -> {
                Object[] r = (Object[]) row;
                return new MeasurementDTO(
                    parseInstant(r[0]),
                    (String) r[1],
                    ((Number) r[2]).intValue(),
                    (String) r[3],
                    ((Number) r[4]).doubleValue()
                );
            })
            .toList();
    }
    
    /**
     * Get statistics (min, max, avg, stddev, count) for all metrics of all assets
     * belonging to a site over a time range.
     *
     * @param siteId Site UUID
     * @param from   Start time
     * @param to     End time
     * @return List of per-device per-metric statistics
     */
    @SuppressWarnings("unchecked")
    public List<MeasurementStatisticsDTO> getSiteStatistics(
            UUID siteId, Instant from, Instant to) {
        
        // Same recursive CONTAINS traversal as getSiteMeasurements
        String sql = """
            WITH RECURSIVE site_tree AS (
                SELECT CAST(:siteId AS uuid) AS obj_id
                UNION ALL
                SELECT l.target_object_id
                FROM links l
                JOIN link_types lt ON l.link_type_id = lt.id AND lt.name = 'CONTAINS'
                JOIN site_tree st ON l.source_object_id = st.obj_id
            ),
            site_devices AS (
                SELECT DISTINCT pd.device_id
                FROM physical_devices pd
                JOIN links rb ON rb.target_object_id = pd.id
                JOIN link_types rb_lt ON rb.link_type_id = rb_lt.id AND rb_lt.name = 'REALIZED_BY'
                WHERE rb.source_object_id IN (SELECT obj_id FROM site_tree)
                UNION
                SELECT pd2.device_id
                FROM physical_devices pd2
                JOIN links rb2 ON rb2.target_object_id = pd2.id
                JOIN link_types rb2_lt ON rb2.link_type_id = rb2_lt.id AND rb2_lt.name = 'REALIZED_BY'
                JOIN links ia ON ia.source_object_id = rb2.source_object_id
                JOIN link_types ia_lt ON ia.link_type_id = ia_lt.id AND ia_lt.name = 'INSTALLED_AT'
                WHERE ia.target_object_id = CAST(:siteId AS uuid)
            )
            SELECT
                m.device_id,
                m.metric_id,
                COALESCE(mp_obj.display_name, 'unknown') AS metric_name,
                MIN(m.value) AS min_val,
                MAX(m.value) AS max_val,
                AVG(m.value) AS avg_val,
                COALESCE(STDDEV(m.value), 0) AS std_val,
                COUNT(*) AS sample_count
            FROM measurements m
            LEFT JOIN metric_points mp ON m.device_id = mp.device_id AND m.metric_id = mp.metric_id
            LEFT JOIN objects mp_obj ON mp.id = mp_obj.id
            WHERE m.device_id IN (SELECT device_id FROM site_devices)
              AND m.time >= :from
              AND m.time <= :to
            GROUP BY m.device_id, m.metric_id, mp_obj.display_name
            ORDER BY m.device_id, m.metric_id
            """;
        
        return entityManager.createNativeQuery(sql)
            .setParameter("siteId", siteId)
            .setParameter("from", from)
            .setParameter("to", to)
            .getResultStream()
            .map(row -> {
                Object[] r = (Object[]) row;
                return new MeasurementStatisticsDTO(
                    (String) r[0],
                    ((Number) r[1]).intValue(),
                    (String) r[2],
                    ((Number) r[3]).doubleValue(),
                    ((Number) r[4]).doubleValue(),
                    ((Number) r[5]).doubleValue(),
                    ((Number) r[6]).doubleValue(),
                    ((Number) r[7]).longValue()
                );
            })
            .toList();
    }
    
    /**
     * Robust Instant parsing from native query results.
     * Handles Timestamp, OffsetDateTime, Date, and fallback to string parsing.
     */
    private Instant parseInstant(Object value) {
        if (value instanceof java.sql.Timestamp ts) {
            return ts.toInstant();
        } else if (value instanceof java.time.OffsetDateTime odt) {
            return odt.toInstant();
        } else if (value instanceof java.util.Date d) {
            return d.toInstant();
        }
        return Instant.parse(value.toString());
    }
    
    /**
     * Fetch the most recent measurement value for a device+metric combination.
     * Used by KpiFormulaService to resolve DIRECT variable values.
     *
     * @param deviceId  Hardware device ID
     * @param metricId  Metric channel index (short)
     * @return the latest value, or empty if no measurements exist
     */
    @SuppressWarnings("unchecked")
    public Optional<Double> findLatestValue(String deviceId, short metricId) {
        String sql = "SELECT value FROM measurements WHERE device_id = :deviceId AND metric_id = :metricId ORDER BY time DESC LIMIT 1";
        List<?> results = entityManager.createNativeQuery(sql)
            .setParameter("deviceId", deviceId)
            .setParameter("metricId", (int) metricId)
            .getResultList();
        if (results.isEmpty()) return Optional.empty();
        return Optional.of(((Number) results.get(0)).doubleValue());
    }

    /**
     * Lightweight record for fleet health: which site does a device belong to,
     * and when was its most recent measurement?
     */
    public record DeviceLastSeen(UUID siteId, String deviceId, Instant lastTime) {}

    /**
     * Batch-fetch the most recent measurement timestamp per device for all assets
     * belonging to the given site IDs. Used by FleetService for health computation.
     *
     * @param siteIds list of site UUIDs to query
     * @return one row per device with its site_id and latest measurement time
     */
    @SuppressWarnings("unchecked")
    public List<DeviceLastSeen> getLastSeenBySiteIds(List<UUID> siteIds) {
        if (siteIds == null || siteIds.isEmpty()) {
            return Collections.emptyList();
        }

        String sql = """
            SELECT
                ia.target_object_id AS site_id,
                pd.device_id,
                (SELECT MAX(m.time) FROM measurements m WHERE m.device_id = pd.device_id) AS last_time
            FROM links ia
            JOIN link_types ia_lt ON ia.link_type_id = ia_lt.id AND ia_lt.name = 'INSTALLED_AT'
            JOIN links rb ON rb.source_object_id = ia.source_object_id
            JOIN link_types rb_lt ON rb.link_type_id = rb_lt.id AND rb_lt.name = 'REALIZED_BY'
            JOIN physical_devices pd ON pd.id = rb.target_object_id
            WHERE ia.target_object_id IN :siteIds
            """;

        return entityManager.createNativeQuery(sql)
            .setParameter("siteIds", siteIds)
            .getResultStream()
            .map(row -> {
                Object[] r = (Object[]) row;
                UUID siteId = (r[0] instanceof java.util.UUID) ? (java.util.UUID) r[0] : java.util.UUID.fromString(r[0].toString());
                String deviceId = (String) r[1];
                Instant lastTime = r[2] != null ? parseInstant(r[2]) : null;
                return new DeviceLastSeen(siteId, deviceId, lastTime);
            })
            .toList();
    }

    /**
     * Enriched device health record for project overview: includes ontology object metadata
     * (display name, type) alongside the physical device's last-seen timestamp.
     */
    public record DeviceHealthDetail(
        UUID siteId, UUID objectId, String objectName,
        String objectTypeName, String objectTypeCategory,
        String deviceId, Instant lastTime
    ) {}

    /**
     * Batch-fetch device health details for all device-category objects installed at the given sites.
     * Returns one row per physical device with its ontology metadata and latest measurement time.
     * Used by ProjectService for the project overview health endpoint.
     *
     * @param siteIds list of building/site UUIDs to query
     * @return enriched device health details including object names and types
     */
    @SuppressWarnings("unchecked")
    public List<DeviceHealthDetail> getDeviceHealthBySiteIds(List<UUID> siteIds) {
        if (siteIds == null || siteIds.isEmpty()) {
            return Collections.emptyList();
        }

        String sql = """
            SELECT
                ia.target_object_id AS site_id,
                ia.source_object_id AS object_id,
                o.display_name AS object_name,
                ot.name AS object_type_name,
                ot.category AS object_type_category,
                pd.device_id,
                (SELECT MAX(m.time) FROM measurements m WHERE m.device_id = pd.device_id) AS last_time
            FROM links ia
            JOIN link_types ia_lt ON ia.link_type_id = ia_lt.id AND ia_lt.name = 'INSTALLED_AT'
            JOIN objects o ON o.id = ia.source_object_id
            JOIN object_types ot ON o.object_type_id = ot.id
            JOIN links rb ON rb.source_object_id = ia.source_object_id
            JOIN link_types rb_lt ON rb.link_type_id = rb_lt.id AND rb_lt.name = 'REALIZED_BY'
            JOIN physical_devices pd ON pd.id = rb.target_object_id
            WHERE ia.target_object_id IN :siteIds
            """;

        return entityManager.createNativeQuery(sql)
            .setParameter("siteIds", siteIds)
            .getResultStream()
            .map(row -> {
                Object[] r = (Object[]) row;
                UUID siteId = (r[0] instanceof java.util.UUID) ? (java.util.UUID) r[0] : java.util.UUID.fromString(r[0].toString());
                UUID objectId = (r[1] instanceof java.util.UUID) ? (java.util.UUID) r[1] : java.util.UUID.fromString(r[1].toString());
                String objectName = (String) r[2];
                String objectTypeName = (String) r[3];
                String objectTypeCategory = (String) r[4];
                String deviceId = (String) r[5];
                Instant lastTime = r[6] != null ? parseInstant(r[6]) : null;
                return new DeviceHealthDetail(siteId, objectId, objectName, objectTypeName, objectTypeCategory, deviceId, lastTime);
            })
            .toList();
    }

    /**
     * Get aggregated measurements for a set of metric point IDs.
     * Resolves each metric point to its (device_id, metric_id) pair and queries the hypertable.
     */
    @SuppressWarnings("unchecked")
    public List<MeasurementDTO> getMeasurementsByMetricPointIds(
            Collection<UUID> metricPointIds, Instant from, Instant to, int bucketMinutes) {
        if (metricPointIds == null || metricPointIds.isEmpty()) {
            return Collections.emptyList();
        }

        String sql = """
            SELECT
                time_bucket(make_interval(mins => :bucketMinutes), m.time) AS bucket,
                m.device_id,
                m.metric_id,
                COALESCE(mp_obj.display_name, 'unknown') AS metric_name,
                AVG(m.value) AS avg_value
            FROM measurements m
            JOIN metric_points mp ON m.device_id = mp.device_id AND m.metric_id = mp.metric_id
            JOIN objects mp_obj ON mp.id = mp_obj.id
            WHERE mp.id IN :metricPointIds
              AND m.time >= :from
              AND m.time <= :to
            GROUP BY bucket, m.device_id, m.metric_id, mp_obj.display_name
            ORDER BY bucket DESC, m.device_id, m.metric_id
            """;

        return entityManager.createNativeQuery(sql)
            .setParameter("metricPointIds", metricPointIds)
            .setParameter("from", from)
            .setParameter("to", to)
            .setParameter("bucketMinutes", bucketMinutes)
            .getResultStream()
            .map(row -> {
                Object[] r = (Object[]) row;
                return new MeasurementDTO(
                    parseInstant(r[0]),
                    (String) r[1],
                    ((Number) r[2]).intValue(),
                    (String) r[3],
                    ((Number) r[4]).doubleValue()
                );
            })
            .toList();
    }

    /**
     * Get raw (unbucketed) measurements for a set of metric point IDs — every individual data point.
     * Used when the user explicitly requests all data points without aggregation.
     */
    @SuppressWarnings("unchecked")
    public List<MeasurementDTO> getRawMeasurementsByMetricPointIds(
            Collection<UUID> metricPointIds, Instant from, Instant to) {
        if (metricPointIds == null || metricPointIds.isEmpty()) {
            return Collections.emptyList();
        }

        String sql = """
            SELECT
                m.time,
                m.device_id,
                m.metric_id,
                COALESCE(mp_obj.display_name, 'unknown') AS metric_name,
                m.value
            FROM measurements m
            JOIN metric_points mp ON m.device_id = mp.device_id AND m.metric_id = mp.metric_id
            JOIN objects mp_obj ON mp.id = mp_obj.id
            WHERE mp.id IN :metricPointIds
              AND m.time >= :from
              AND m.time <= :to
            ORDER BY m.time DESC, m.device_id, m.metric_id
            """;

        return entityManager.createNativeQuery(sql)
            .setParameter("metricPointIds", metricPointIds)
            .setParameter("from", from)
            .setParameter("to", to)
            .getResultStream()
            .map(row -> {
                Object[] r = (Object[]) row;
                return new MeasurementDTO(
                    parseInstant(r[0]),
                    (String) r[1],
                    ((Number) r[2]).intValue(),
                    (String) r[3],
                    ((Number) r[4]).doubleValue()
                );
            })
            .toList();
    }

    /**
     * Cross-building comparison: aggregated measurements for a given physical quantity
     * across multiple sites. Returns rows with site context.
     *
     * Each row: [bucket, site_id, site_name, avg_value]
     */
    @SuppressWarnings("unchecked")
    public List<Object[]> getMeasurementsByQuantityAndSites(
            List<UUID> siteIds, String quantityName, Instant from, Instant to, int bucketMinutes) {
        if (siteIds == null || siteIds.isEmpty()) {
            return Collections.emptyList();
        }

        String sql = """
            WITH RECURSIVE site_tree AS (
                SELECT s.id AS site_id, s.id AS obj_id, s.display_name AS site_name
                FROM objects s
                WHERE s.id IN :siteIds
                UNION ALL
                SELECT st.site_id, l.target_object_id, st.site_name
                FROM links l
                JOIN link_types lt ON l.link_type_id = lt.id AND lt.name = 'CONTAINS'
                JOIN site_tree st ON l.source_object_id = st.obj_id
            ),
            site_assets AS (
                SELECT DISTINCT st.site_id, st.site_name, ia.source_object_id AS asset_id
                FROM site_tree st
                JOIN links ia ON ia.target_object_id = st.obj_id
                JOIN link_types ia_lt ON ia.link_type_id = ia_lt.id AND ia_lt.name = 'INSTALLED_AT'
                UNION
                SELECT DISTINCT st.site_id, st.site_name, st.obj_id AS asset_id
                FROM site_tree st
            ),
            site_metric_points AS (
                SELECT sa.site_id, sa.site_name, mp.device_id, mp.metric_id
                FROM site_assets sa
                JOIN links hm ON hm.source_object_id = sa.asset_id
                JOIN link_types hm_lt ON hm.link_type_id = hm_lt.id AND hm_lt.name = 'HAS_METRIC'
                JOIN metric_points mp ON hm.target_object_id = mp.id
                JOIN physical_quantities pq ON mp.quantity_id = pq.id AND pq.name = :quantityName
            )
            SELECT
                time_bucket(make_interval(mins => :bucketMinutes), m.time) AS bucket,
                smp.site_id,
                smp.site_name,
                AVG(m.value) AS avg_value
            FROM measurements m
            JOIN site_metric_points smp ON m.device_id = smp.device_id AND m.metric_id = smp.metric_id
            WHERE m.time >= :from
              AND m.time <= :to
            GROUP BY bucket, smp.site_id, smp.site_name
            ORDER BY smp.site_name, bucket DESC
            """;

        return entityManager.createNativeQuery(sql)
            .setParameter("siteIds", siteIds)
            .setParameter("quantityName", quantityName)
            .setParameter("from", from)
            .setParameter("to", to)
            .setParameter("bucketMinutes", bucketMinutes)
            .getResultList();
    }

    /**
     * Batch-fetch the latest measurement value per metric point for a set of metric point IDs.
     * Returns one row per metric point with its most recent value and enriched context.
     * Used by the synoptic view for live value overlays.
     *
     * Each row: [metric_point_id, device_id, metric_id, display_name, unit, quantity_name, asset_object_id, value, time]
     */
    @SuppressWarnings("unchecked")
    public List<Object[]> getLatestByMetricPointIds(Collection<UUID> metricPointIds) {
        if (metricPointIds == null || metricPointIds.isEmpty()) {
            return Collections.emptyList();
        }

        String sql = """
            SELECT
                mp.id AS metric_point_id,
                mp.device_id,
                mp.metric_id,
                COALESCE(mp_obj.display_name, 'unknown') AS display_name,
                COALESCE(mp.unit, pq.default_unit, '') AS unit,
                COALESCE(pq.name, '') AS quantity_name,
                hm.source_object_id AS asset_object_id,
                latest.value,
                latest.time
            FROM metric_points mp
            JOIN objects mp_obj ON mp.id = mp_obj.id
            LEFT JOIN physical_quantities pq ON mp.quantity_id = pq.id
            LEFT JOIN links hm ON hm.target_object_id = mp.id
                AND hm.link_type_id = (SELECT id FROM link_types WHERE name = 'HAS_METRIC' LIMIT 1)
            LEFT JOIN LATERAL (
                SELECT m.value, m.time
                FROM measurements m
                WHERE m.device_id = mp.device_id AND m.metric_id = mp.metric_id
                ORDER BY m.time DESC
                LIMIT 1
            ) latest ON true
            WHERE mp.id IN :metricPointIds
            """;

        return entityManager.createNativeQuery(sql)
            .setParameter("metricPointIds", metricPointIds)
            .getResultList();
    }

    /**
     * Get latest measurement per metric for an asset.
     */
    @SuppressWarnings("unchecked")
    public List<MeasurementDTO> getLatestMeasurements(String deviceId, List<Integer> metricIds) {
        String metricFilter = (metricIds != null && !metricIds.isEmpty())
            ? "AND m.metric_id IN (:metricIds)"
            : "";

        String sql = """
            SELECT DISTINCT ON (m.metric_id)
                m.time,
                m.device_id,
                m.metric_id,
                COALESCE(mp_obj.display_name, 'unknown') AS metric_name,
                m.value
            FROM measurements m
            LEFT JOIN metric_points mp ON m.device_id = mp.device_id AND m.metric_id = mp.metric_id
            LEFT JOIN objects mp_obj ON mp.id = mp_obj.id
            WHERE m.device_id = :deviceId
              %s
            ORDER BY m.metric_id, m.time DESC
            """.formatted(metricFilter);

        var query = entityManager.createNativeQuery(sql)
            .setParameter("deviceId", deviceId);

        if (metricIds != null && !metricIds.isEmpty()) {
            query.setParameter("metricIds", metricIds);
        }

        return query.getResultStream()
            .map(row -> {
                Object[] r = (Object[]) row;
                return new MeasurementDTO(
                    parseInstant(r[0]),
                    (String) r[1],
                    ((Number) r[2]).intValue(),
                    (String) r[3],
                    ((Number) r[4]).doubleValue()
                );
            })
            .toList();
    }
}
