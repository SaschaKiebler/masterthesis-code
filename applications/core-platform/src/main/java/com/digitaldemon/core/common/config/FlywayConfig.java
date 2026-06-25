package com.digitaldemon.core.common.config;

import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.flyway.autoconfigure.FlywayMigrationStrategy;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Flyway migration strategy that always runs {@code repair()} before {@code migrate()}.
 *
 * <p>{@code repair()} is lightweight and idempotent. It:
 * <ul>
 *   <li>Removes FAILED migration entries (PostgreSQL rolls back DDL, but Flyway keeps the record)</li>
 *   <li>Realigns checksums of applied migrations to match local files (fixes mismatch after
 *       no-op-ifying obsolete migrations like V4_5)</li>
 * </ul>
 *
 * <p>This avoids startup failures when a migration file is intentionally modified after
 * being applied (e.g. replaced with a no-op because the underlying table was dropped).</p>
 */
@Configuration
@Slf4j
public class FlywayConfig {

    @Bean
    public FlywayMigrationStrategy repairBeforeMigrate() {
        return flyway -> {
            log.info("Running Flyway repair() to align checksums and clear failed entries");
            flyway.repair();
            flyway.migrate();
        };
    }
}
