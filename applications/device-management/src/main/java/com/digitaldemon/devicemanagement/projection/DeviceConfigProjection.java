package com.digitaldemon.devicemanagement.projection;

import com.digitaldemon.device.proto.v1.DeviceConfig;
import com.digitaldemon.device.proto.v1.SignalMapEntry;
import com.digitaldemon.devicemanagement.config.DeviceManagementProperties;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.protobuf.Timestamp;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.sql.ResultSet;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Publishes the desired per-device configuration to the compacted
 * `device.configured` topic (key = device_id).
 *
 * The projection source is the shared database (physical_devices +
 * metric_points, written by core-platform's commissioning flow). A periodic
 * reconciliation sweep diffs the current state against what was last
 * published and emits only changes: updated snapshots, and tombstones for
 * devices that disappeared. The first sweep after startup publishes
 * everything once, which doubles as the reconciliation path for consumers —
 * compaction keeps the topic bounded.
 *
 * This moves config polling out of the ingestion hot path (previously a 120s
 * loop in the ingestion service) into the config owner, where it runs off
 * the data path.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class DeviceConfigProjection {

    private final JdbcClient jdbc;
    private final KafkaTemplate<Object, Object> kafka;
    private final DeviceManagementProperties props;

    private static final ObjectMapper objectMapper = new ObjectMapper();

    /** Fingerprints of the last published config per device id. */
    private final ConcurrentHashMap<String, Integer> published = new ConcurrentHashMap<>();

    private volatile boolean initialSweepDone = false;

    /** Device ids that currently have a configuration (for the watcher's gate). */
    public boolean isKnownDevice(String deviceId) {
        return published.containsKey(deviceId);
    }

    /** True once the first sweep completed, so the watcher can trust isKnownDevice. */
    public boolean isReady() {
        return initialSweepDone;
    }

    @Scheduled(fixedDelayString = "${device-management.projection.sweep-interval-ms:30000}", initialDelay = 2000)
    public void sweep() {
        try {
            Map<String, DeviceConfig.Builder> configs = loadConfigsFromDatabase();
            applySiteCoordinates(configs);

            int publishedCount = 0;
            for (Map.Entry<String, DeviceConfig.Builder> entry : configs.entrySet()) {
                String deviceId = entry.getKey();
                DeviceConfig.Builder builder = entry.getValue();

                // Fingerprint over the config content only (updated_at excluded,
                // otherwise every sweep would look like a change).
                int fingerprint = Arrays.hashCode(builder.build().toByteArray());
                Integer previous = published.get(deviceId);
                if (previous != null && previous == fingerprint) {
                    continue;
                }

                Instant now = Instant.now();
                DeviceConfig config = builder
                        .setUpdatedAt(Timestamp.newBuilder()
                                .setSeconds(now.getEpochSecond())
                                .setNanos(now.getNano()))
                        .build();

                kafka.send(props.getTopics().getDeviceConfigured(),
                        deviceId.getBytes(StandardCharsets.UTF_8),
                        config.toByteArray());
                published.put(deviceId, fingerprint);
                publishedCount++;
                log.info("Published device.configured for {} (accepted={}, {} signals)",
                        deviceId, config.getAccepted(), config.getSignalsCount());
            }

            // Tombstones for devices that vanished from the database
            int tombstones = 0;
            for (String deviceId : new ArrayList<>(published.keySet())) {
                if (!configs.containsKey(deviceId)) {
                    kafka.send(props.getTopics().getDeviceConfigured(),
                            deviceId.getBytes(StandardCharsets.UTF_8),
                            null);
                    published.remove(deviceId);
                    tombstones++;
                    log.info("Published device.configured tombstone for {}", deviceId);
                }
            }

            if (!initialSweepDone) {
                initialSweepDone = true;
                log.info("Initial device-config sweep complete: {} devices published", publishedCount);
            } else if (publishedCount > 0 || tombstones > 0) {
                log.info("Device-config sweep: {} updated, {} removed", publishedCount, tombstones);
            }
        } catch (Exception e) {
            log.error("Device-config sweep failed: {}", e.getMessage(), e);
        }
    }

    /**
     * Load every device's desired config: identity and accept-flag from
     * physical_devices, decode rules from metric_points, display names from
     * the metric-point ontology objects.
     */
    private Map<String, DeviceConfig.Builder> loadConfigsFromDatabase() {
        return jdbc.sql("""
                SELECT pd.device_id,
                       pd.protocol,
                       pd.decommissioned_at,
                       mp.metric_id,
                       mp.unit,
                       mp.source,
                       mp.field,
                       mp.min_value,
                       mp.max_value,
                       o.display_name
                FROM physical_devices pd
                LEFT JOIN metric_points mp ON mp.device_id = pd.device_id
                LEFT JOIN objects o ON o.id = mp.id
                ORDER BY pd.device_id, mp.metric_id
                """)
            .query((ResultSet rs) -> {
                Map<String, DeviceConfig.Builder> configs = new LinkedHashMap<>();
                while (rs.next()) {
                    String deviceId = rs.getString("device_id");
                    DeviceConfig.Builder builder = configs.computeIfAbsent(deviceId, id ->
                            DeviceConfig.newBuilder()
                                    .setDeviceId(id)
                                    .setAccepted(true));

                    builder.setAccepted(rs.getTimestamp("decommissioned_at") == null);
                    String protocol = rs.getString("protocol");
                    builder.setProtocol(protocol != null ? protocol : "");

                    int metricId = rs.getInt("metric_id");
                    if (!rs.wasNull()) {
                        SignalMapEntry.Builder signal = SignalMapEntry.newBuilder()
                                .setMetricId(metricId)
                                .setName(Objects.requireNonNullElse(rs.getString("display_name"), ""))
                                .setUnit(Objects.requireNonNullElse(rs.getString("unit"), ""))
                                .setSource(Objects.requireNonNullElse(rs.getString("source"), ""))
                                .setField(Objects.requireNonNullElse(rs.getString("field"), ""));

                        double min = rs.getDouble("min_value");
                        if (!rs.wasNull()) signal.setMinValue(min);
                        double max = rs.getDouble("max_value");
                        if (!rs.wasNull()) signal.setMaxValue(max);

                        builder.addSignals(signal);
                    }
                }
                return configs;
            });
    }

    /**
     * Resolve each device's site coordinates by walking the ontology graph
     * upwards from the device's asset (inbound REALIZED_BY), via
     * INSTALLED_AT/INSTALLED_IN and up the CONTAINS chain. The nearest object
     * whose {@code properties -> attributes} JSON carries latitude/longitude
     * wins. Coordinates flow into the config fingerprint, so location changes
     * republish automatically.
     */
    private void applySiteCoordinates(Map<String, DeviceConfig.Builder> configs) {
        Map<String, double[]> coordinates = jdbc.sql("""
                WITH RECURSIVE lt AS (
                    SELECT id, name FROM link_types
                    WHERE name IN ('REALIZED_BY', 'CONTAINS', 'INSTALLED_AT', 'INSTALLED_IN')
                ),
                device_assets AS (
                    SELECT pd.device_id, l.source_object_id AS object_id
                    FROM physical_devices pd
                    JOIN links l ON l.target_object_id = pd.id
                    JOIN lt ON lt.id = l.link_type_id AND lt.name = 'REALIZED_BY'
                ),
                up AS (
                    SELECT device_id, object_id, 0 AS depth FROM device_assets
                    UNION ALL
                    SELECT up.device_id, parents.next_object, up.depth + 1
                    FROM up
                    JOIN LATERAL (
                        SELECT l.target_object_id AS next_object
                        FROM links l JOIN lt ON lt.id = l.link_type_id
                        WHERE l.source_object_id = up.object_id
                          AND lt.name IN ('INSTALLED_AT', 'INSTALLED_IN')
                        UNION
                        SELECT l.source_object_id
                        FROM links l JOIN lt ON lt.id = l.link_type_id
                        WHERE l.target_object_id = up.object_id AND lt.name = 'CONTAINS'
                    ) parents ON TRUE
                    WHERE up.depth < 6
                )
                SELECT u.device_id, u.depth, o.properties::text AS properties
                FROM up u
                JOIN objects o ON o.id = u.object_id
                WHERE o.properties IS NOT NULL AND o.properties::text LIKE '%latitude%'
                ORDER BY u.device_id, u.depth
                """)
            .query((ResultSet rs) -> {
                Map<String, double[]> result = new LinkedHashMap<>();
                while (rs.next()) {
                    String deviceId = rs.getString("device_id");
                    if (result.containsKey(deviceId)) {
                        continue; // nearest match (lowest depth) already found
                    }
                    double[] coords = parseCoordinates(rs.getString("properties"));
                    if (coords != null) {
                        result.put(deviceId, coords);
                    }
                }
                return result;
            });

        for (Map.Entry<String, double[]> entry : coordinates.entrySet()) {
            DeviceConfig.Builder builder = configs.get(entry.getKey());
            if (builder != null) {
                builder.setSiteLatitude(entry.getValue()[0]);
                builder.setSiteLongitude(entry.getValue()[1]);
            }
        }
    }

    /** The attributes field is nested JSON inside the properties JSONB. */
    private static double[] parseCoordinates(String propertiesJson) {
        try {
            JsonNode properties = objectMapper.readTree(propertiesJson);
            JsonNode attributes = properties.path("attributes");
            if (attributes.isTextual()) {
                attributes = objectMapper.readTree(attributes.asText());
            }
            JsonNode lat = attributes.path("latitude");
            JsonNode lon = attributes.path("longitude");
            if (lat.isNumber() && lon.isNumber()) {
                return new double[] {lat.asDouble(), lon.asDouble()};
            }
            if (lat.isTextual() && lon.isTextual()) {
                return new double[] {Double.parseDouble(lat.asText()), Double.parseDouble(lon.asText())};
            }
            return null;
        } catch (Exception e) {
            return null;
        }
    }
}
