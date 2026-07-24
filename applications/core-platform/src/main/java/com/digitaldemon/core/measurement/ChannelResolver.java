package com.digitaldemon.core.measurement;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

/**
 * Resolve, then stop (measurement-read-decoupling design §4): core walks its
 * ontology graph down to channels — the (device_id, metric_id) telemetry
 * identity of a metric point — and never touches the measurements store.
 * Series and statistics are fetched from the analytics service by the BFF,
 * keyed on these channels with the metric-point id as opaque ref.
 */
@Repository
public class ChannelResolver {

    @PersistenceContext
    private EntityManager em;

    /** The telemetry identity of a metric point. */
    public record Channel(UUID metricPointId, String deviceId, int metricId,
                          String displayName, String unit, String source) {
    }

    /** Channel with the site context needed for cross-building comparison. */
    public record SiteChannel(UUID siteId, String siteName, String deviceId, int metricId) {
    }

    /** Graph half of the former fleet last-seen query: site → device. */
    public record DeviceSite(UUID siteId, String deviceId) {
    }

    /** Graph half of the former device-health query (no measurement time). */
    public record DeviceDetail(UUID siteId, UUID objectId, String objectName,
                               String objectTypeName, String objectTypeCategory, String deviceId) {
    }

    /** Registry context of a metric point for latest-value overlays. */
    public record LatestValueContext(UUID metricPointId, String deviceId, int metricId,
                                     String displayName, String unit, String quantityName,
                                     UUID assetObjectId) {
    }

    /**
     * All channels of a site: recursive CONTAINS walk downward, devices via
     * REALIZED_BY from any object in the subtree, plus legacy INSTALLED_AT
     * links directly on the site — the former getSiteMeasurements CTE with
     * the measurement half amputated.
     */
    @SuppressWarnings("unchecked")
    public List<Channel> resolveSite(UUID siteId) {
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
            SELECT mp.id, mp.device_id, mp.metric_id,
                   COALESCE(o.display_name, 'unknown'), mp.unit, mp.source
            FROM metric_points mp
            LEFT JOIN objects o ON o.id = mp.id
            WHERE mp.device_id IN (SELECT device_id FROM site_devices)
            ORDER BY mp.device_id, mp.metric_id
            """;
        return mapChannels(em.createNativeQuery(sql).setParameter("siteId", siteId).getResultList());
    }

    /** Channels for a set of metric-point ids. */
    @SuppressWarnings("unchecked")
    public List<Channel> resolveMetricPoints(Collection<UUID> metricPointIds) {
        if (metricPointIds == null || metricPointIds.isEmpty()) {
            return Collections.emptyList();
        }
        String sql = """
            SELECT mp.id, mp.device_id, mp.metric_id,
                   COALESCE(o.display_name, 'unknown'), mp.unit, mp.source
            FROM metric_points mp
            LEFT JOIN objects o ON o.id = mp.id
            WHERE mp.id IN :metricPointIds
            ORDER BY mp.device_id, mp.metric_id
            """;
        return mapChannels(em.createNativeQuery(sql)
                .setParameter("metricPointIds", metricPointIds).getResultList());
    }

    /** Channels of a single device (the asset read path). */
    @SuppressWarnings("unchecked")
    public List<Channel> resolveDevice(String deviceId) {
        if (deviceId == null) {
            return Collections.emptyList();
        }
        String sql = """
            SELECT mp.id, mp.device_id, mp.metric_id,
                   COALESCE(o.display_name, 'unknown'), mp.unit, mp.source
            FROM metric_points mp
            LEFT JOIN objects o ON o.id = mp.id
            WHERE mp.device_id = :deviceId
            ORDER BY mp.metric_id
            """;
        return mapChannels(em.createNativeQuery(sql).setParameter("deviceId", deviceId).getResultList());
    }

    /**
     * Channels of a physical quantity across sites, with site context —
     * the graph half of the former cross-building comparison query.
     */
    @SuppressWarnings("unchecked")
    public List<SiteChannel> resolveByQuantity(List<UUID> siteIds, String quantityName) {
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
            )
            SELECT sa.site_id, sa.site_name, mp.device_id, mp.metric_id
            FROM site_assets sa
            JOIN links hm ON hm.source_object_id = sa.asset_id
            JOIN link_types hm_lt ON hm.link_type_id = hm_lt.id AND hm_lt.name = 'HAS_METRIC'
            JOIN metric_points mp ON hm.target_object_id = mp.id
            JOIN physical_quantities pq ON mp.quantity_id = pq.id AND pq.name = :quantityName
            """;
        List<Object[]> rows = em.createNativeQuery(sql)
                .setParameter("siteIds", siteIds)
                .setParameter("quantityName", quantityName)
                .getResultList();
        return rows.stream().map(r -> new SiteChannel(
                toUuid(r[0]), (String) r[1], (String) r[2], ((Number) r[3]).intValue())).toList();
    }

    /** Site → device mapping for fleet health (former getLastSeenBySiteIds, graph half). */
    @SuppressWarnings("unchecked")
    public List<DeviceSite> devicesBySites(List<UUID> siteIds) {
        if (siteIds == null || siteIds.isEmpty()) {
            return Collections.emptyList();
        }
        String sql = """
            SELECT ia.target_object_id AS site_id, pd.device_id
            FROM links ia
            JOIN link_types ia_lt ON ia.link_type_id = ia_lt.id AND ia_lt.name = 'INSTALLED_AT'
            JOIN links rb ON rb.source_object_id = ia.source_object_id
            JOIN link_types rb_lt ON rb.link_type_id = rb_lt.id AND rb_lt.name = 'REALIZED_BY'
            JOIN physical_devices pd ON pd.id = rb.target_object_id
            WHERE ia.target_object_id IN :siteIds
            """;
        List<Object[]> rows = em.createNativeQuery(sql).setParameter("siteIds", siteIds).getResultList();
        return rows.stream().map(r -> new DeviceSite(toUuid(r[0]), (String) r[1])).toList();
    }

    /** Device details for project health (former getDeviceHealthBySiteIds, graph half). */
    @SuppressWarnings("unchecked")
    public List<DeviceDetail> deviceDetailsBySites(List<UUID> siteIds) {
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
                pd.device_id
            FROM links ia
            JOIN link_types ia_lt ON ia.link_type_id = ia_lt.id AND ia_lt.name = 'INSTALLED_AT'
            JOIN objects o ON o.id = ia.source_object_id
            JOIN object_types ot ON o.object_type_id = ot.id
            JOIN links rb ON rb.source_object_id = ia.source_object_id
            JOIN link_types rb_lt ON rb.link_type_id = rb_lt.id AND rb_lt.name = 'REALIZED_BY'
            JOIN physical_devices pd ON pd.id = rb.target_object_id
            WHERE ia.target_object_id IN :siteIds
            """;
        List<Object[]> rows = em.createNativeQuery(sql).setParameter("siteIds", siteIds).getResultList();
        return rows.stream().map(r -> new DeviceDetail(
                toUuid(r[0]), toUuid(r[1]), (String) r[2], (String) r[3], (String) r[4], (String) r[5]))
                .toList();
    }

    /** Registry context of metric points (former getLatestByMetricPointIds, registry half). */
    @SuppressWarnings("unchecked")
    public List<LatestValueContext> latestValueContext(Collection<UUID> metricPointIds) {
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
                hm.source_object_id AS asset_object_id
            FROM metric_points mp
            JOIN objects mp_obj ON mp.id = mp_obj.id
            LEFT JOIN physical_quantities pq ON mp.quantity_id = pq.id
            LEFT JOIN links hm ON hm.target_object_id = mp.id
                AND hm.link_type_id = (SELECT id FROM link_types WHERE name = 'HAS_METRIC' LIMIT 1)
            WHERE mp.id IN :metricPointIds
            """;
        List<Object[]> rows = em.createNativeQuery(sql)
                .setParameter("metricPointIds", metricPointIds).getResultList();
        return rows.stream().map(r -> new LatestValueContext(
                toUuid(r[0]), (String) r[1], ((Number) r[2]).intValue(),
                (String) r[3], (String) r[4], (String) r[5],
                r[6] != null ? toUuid(r[6]) : null))
                .toList();
    }

    private static List<Channel> mapChannels(List<Object[]> rows) {
        return rows.stream().map(r -> new Channel(
                toUuid(r[0]), (String) r[1], ((Number) r[2]).intValue(),
                (String) r[3], (String) r[4], (String) r[5]))
                .toList();
    }

    private static UUID toUuid(Object value) {
        return value instanceof UUID uuid ? uuid : UUID.fromString(value.toString());
    }
}
