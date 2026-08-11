package com.digitaldemon.core.privacy;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;

/**
 * Reads measurement series for the GDPR export. Read-only by construction
 * (see {@link MeasurementReadConfig}); the deletion path never touches
 * measurements — severing the person link is what anonymises the series
 * (thesis ch. 6, QS-SEC-02 vs. QS-INT trade-off).
 */
@Repository
public class MeasurementReadStore {

    /** One exported measurement value. */
    public record MeasurementRow(Instant time, short metricId, double value) {
    }

    private final JdbcTemplate jdbc;

    public MeasurementReadStore(@Qualifier("measurementJdbcTemplate") JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Complete series for one device, oldest first — the Art. 15(3) copy. */
    public List<MeasurementRow> seriesForDevice(String deviceId) {
        return jdbc.query(
                "SELECT time, metric_id, value FROM measurements WHERE device_id = ? ORDER BY time",
                (rs, i) -> new MeasurementRow(
                        rs.getTimestamp("time").toInstant(),
                        rs.getShort("metric_id"),
                        rs.getDouble("value")),
                deviceId);
    }

    /** Row count per device, used by the export summary and the evaluation. */
    public long countForDevice(String deviceId) {
        Long count = jdbc.queryForObject(
                "SELECT count(*) FROM measurements WHERE device_id = ?", Long.class, deviceId);
        return count == null ? 0 : count;
    }
}
