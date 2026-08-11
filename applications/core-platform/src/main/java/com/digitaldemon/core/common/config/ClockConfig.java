package com.digitaldemon.core.common.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Clock;

/**
 * A single injectable clock, so time-dependent components (the tenancy caches)
 * can be unit-tested by substituting a fixed clock instead of sleeping.
 */
@Configuration
public class ClockConfig {

    @Bean
    public Clock systemClock() {
        return Clock.systemUTC();
    }
}
