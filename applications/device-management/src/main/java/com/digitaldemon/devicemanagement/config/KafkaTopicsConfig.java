package com.digitaldemon.devicemanagement.config;

import lombok.RequiredArgsConstructor;
import org.apache.kafka.clients.admin.NewTopic;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.config.TopicBuilder;

/**
 * Topic provisioning: device-management owns both device lifecycle topics
 * (see docs/architecture/event-catalog.md). Picked up by the auto-configured
 * KafkaAdmin at startup; creation is idempotent.
 */
@Configuration
@RequiredArgsConstructor
public class KafkaTopicsConfig {

    private final DeviceManagementProperties props;

    /**
     * Compacted reference topic: consumers rebuild full device-config state by
     * replaying it from the beginning; Kafka keeps the latest record per key.
     */
    @Bean
    public NewTopic deviceConfiguredTopic() {
        return TopicBuilder.name(props.getTopics().getDeviceConfigured())
                .partitions(props.getTopics().getPartitions())
                .replicas(props.getTopics().getReplicas())
                .compact()
                .build();
    }

    @Bean
    public NewTopic deviceDiscoveredTopic() {
        return TopicBuilder.name(props.getTopics().getDeviceDiscovered())
                .partitions(props.getTopics().getPartitions())
                .replicas(props.getTopics().getReplicas())
                .build();
    }
}
