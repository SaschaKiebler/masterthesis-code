package com.heatingplatform.core.privacy;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;

import javax.sql.DataSource;

/**
 * Read-only access to the measurement store, used exclusively by the privacy
 * package (thesis QS-SEC-02).
 *
 * <p>The core's primary datasource is the master-data database; measurements
 * live in the separate TimescaleDB the ingestion service writes to. A GDPR
 * export (Art. 15(3)) must hand the data subject a copy of their consumption
 * data, so this is the one place the core reads that store. Architecturally
 * this deepens the documented shared-database deviation (thesis ch. 5.7,
 * deviation 2) by one more reader — deliberate and stated, not hidden.
 *
 * <p>The pool is tiny and never fails startup: privacy requests are rare and
 * the core must come up even when the measurement store is not reachable yet
 * (cluster startup ordering is convergence-based).
 */
@Configuration
public class MeasurementReadConfig {

    /**
     * The master-data JdbcTemplate, declared explicitly and marked primary.
     *
     * <p>This bean is not optional. Spring Boot's auto-configured
     * {@code jdbcTemplate} carries {@code @ConditionalOnMissingBean(JdbcOperations.class)},
     * so the moment the measurement template below exists, the auto-configuration
     * backs off entirely — and every unqualified {@code JdbcTemplate} injection
     * in the application silently switches to the measurement store. That hit
     * {@code AnomalyRuleConfigProjection} and {@code ThresholdRuleConfigProjection},
     * whose sweeps then queried tables that only exist in the master data,
     * breaking the rule projections without a single failing test.
     */
    @Bean
    @Primary
    public JdbcTemplate jdbcTemplate(DataSource dataSource) {
        return new JdbcTemplate(dataSource);
    }

    @Value("${measurement.datasource.url}")
    private String url;

    @Value("${measurement.datasource.username}")
    private String username;

    @Value("${measurement.datasource.password}")
    private String password;

    @Bean(name = "measurementJdbcTemplate")
    public JdbcTemplate measurementJdbcTemplate() {
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl(url);
        config.setUsername(username);
        config.setPassword(password);
        config.setReadOnly(true);
        config.setMaximumPoolSize(2);
        config.setPoolName("measurement-read");
        // Do not probe the store at startup; connect on first privacy request.
        config.setInitializationFailTimeout(-1);
        return new JdbcTemplate(new HikariDataSource(config));
    }
}
