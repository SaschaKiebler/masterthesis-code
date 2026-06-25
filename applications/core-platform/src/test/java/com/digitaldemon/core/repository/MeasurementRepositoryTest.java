package com.digitaldemon.core.repository;

import com.digitaldemon.core.measurement.MeasurementRepository;

import com.digitaldemon.core.measurement.MeasurementDTO;
import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.jdbc.core.JdbcTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@Disabled("Testcontainers initialization failing in env")
@SpringBootTest
@Testcontainers
class MeasurementRepositoryTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer("timescale/timescaledb:latest-pg14");

    @Autowired
    private MeasurementRepository repository;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @BeforeEach
    void setup() {
        // Init Schema
        jdbcTemplate.execute("CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;");
        
        jdbcTemplate.execute("""
            CREATE TABLE IF NOT EXISTS assets (
                id UUID PRIMARY KEY,
                device_id TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                type TEXT NOT NULL,
                signal_map JSONB DEFAULT '{}'
            );
        """);
        
        jdbcTemplate.execute("""
            CREATE TABLE IF NOT EXISTS measurements (
                time TIMESTAMPTZ NOT NULL,
                device_id TEXT NOT NULL,
                metric_id INTEGER NOT NULL,
                value DOUBLE PRECISION NOT NULL
            );
        """);
        
        try {
            jdbcTemplate.execute("SELECT create_hypertable('measurements', 'time', if_not_exists => TRUE);");
        } catch (Exception e) {
            // Ignore if already hypertable
        }
        
        // Clean tables
        jdbcTemplate.execute("TRUNCATE TABLE measurements");
        jdbcTemplate.execute("TRUNCATE TABLE assets CASCADE"); // Cascade to relationships if any, though none defined here in manual schema
        
        // Insert Test Data
        UUID assetId = UUID.randomUUID();
        jdbcTemplate.update(
            "INSERT INTO assets (id, device_id, name, type, signal_map) VALUES (?, ?, ?, ?, ?::jsonb)",
            assetId, "dev1", "Test Asset", "SENSOR", "{\"1\": {\"name\": \"temp\"}}"
        );

        jdbcTemplate.update(
            "INSERT INTO measurements (time, device_id, metric_id, value) VALUES (NOW(), ?, ?, ?)",
            "dev1", 1, 20.0
        );
        jdbcTemplate.update(
            "INSERT INTO measurements (time, device_id, metric_id, value) VALUES (NOW() - INTERVAL '30 minutes', ?, ?, ?)",
            "dev1", 1, 30.0
        );
    }

    @Test
    void getAggregatedMeasurements_ShouldReturnData() {
        Instant to = Instant.now().plusSeconds(3600);
        Instant from = Instant.now().minusSeconds(86400); // 1 day ago
        
        List<MeasurementDTO> results = repository.getAggregatedMeasurements("dev1", from, to, 60, null);
        
        assertThat(results).isNotEmpty();
        MeasurementDTO first = results.get(0);
        assertThat(first.deviceId()).isEqualTo("dev1");
        assertThat(first.metricName()).isEqualTo("temp");
    }
}
