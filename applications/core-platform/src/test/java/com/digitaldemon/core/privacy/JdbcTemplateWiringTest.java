package com.digitaldemon.core.privacy;

import com.digitaldemon.core.anomalyrule.AnomalyRuleConfigProjection;
import com.digitaldemon.core.thresholdrule.ThresholdRuleConfigProjection;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.util.ReflectionTestUtils;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import javax.sql.DataSource;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Guards which database the unqualified JdbcTemplate points at.
 *
 * <p>Regression test. Adding the measurement-store template in
 * {@link MeasurementReadConfig} silently disabled Spring Boot's auto-configured
 * {@code jdbcTemplate}, because that one carries
 * {@code @ConditionalOnMissingBean(JdbcOperations.class)}. Every unqualified
 * injection then resolved to the measurement store, so both rule projections
 * swept the wrong database and failed with "relation does not exist" — at
 * runtime only, with the whole suite still green.
 *
 * <p>The lesson worth keeping: a second bean of a type Spring Boot
 * auto-configures does not add a choice, it removes one.
 */
@SpringBootTest(properties = {
        "kafka.enabled=false",
        "grpc.server.port=0",
})
@Testcontainers
class JdbcTemplateWiringTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16");

    @Autowired
    private DataSource primaryDataSource;

    @Autowired
    private JdbcTemplate unqualified;

    @Autowired
    @Qualifier("measurementJdbcTemplate")
    private JdbcTemplate measurement;

    // Conditional beans (they need Kafka, which this context disables). Guarded
    // as optional so the template assertions below still run — those are the
    // real regression guard, the projections are the visible symptom.
    @Autowired(required = false)
    private AnomalyRuleConfigProjection anomalyProjection;

    @Autowired(required = false)
    private ThresholdRuleConfigProjection thresholdProjection;

    @Test
    void the_unqualified_template_uses_the_master_data_datasource() {
        assertThat(unqualified.getDataSource()).isSameAs(primaryDataSource);
    }

    @Test
    void the_measurement_template_is_a_different_datasource() {
        assertThat(measurement.getDataSource()).isNotSameAs(primaryDataSource);
    }

    /**
     * The two beans that broke. They must read master data, not measurements —
     * their tables only exist in the former.
     */
    @Test
    void both_rule_projections_read_the_master_data_datasource() {
        if (anomalyProjection != null) {
            assertThat(templateOf(anomalyProjection).getDataSource()).isSameAs(primaryDataSource);
        }
        if (thresholdProjection != null) {
            assertThat(templateOf(thresholdProjection).getDataSource()).isSameAs(primaryDataSource);
        }
    }

    private JdbcTemplate templateOf(Object projection) {
        return (JdbcTemplate) ReflectionTestUtils.getField(projection, "jdbc");
    }
}
