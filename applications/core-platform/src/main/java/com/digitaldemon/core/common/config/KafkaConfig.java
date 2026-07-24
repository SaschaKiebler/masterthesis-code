package com.digitaldemon.core.common.config;

import lombok.RequiredArgsConstructor;
import org.apache.kafka.clients.admin.NewTopic;
import org.apache.kafka.common.TopicPartition;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.config.TopicBuilder;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.listener.DeadLetterPublishingRecoverer;
import org.springframework.kafka.listener.DefaultErrorHandler;
import org.springframework.util.backoff.FixedBackOff;

/**
 * Kafka wiring beyond what Spring Boot auto-configures from spring.kafka.*:
 * declarative topic provisioning and the dead-letter error handler.
 *
 * Only active when kafka.enabled=true (default true) so tests can run
 * without a broker, mirroring the mqtt.enabled switch.
 */
@Configuration
@RequiredArgsConstructor
@ConditionalOnProperty(name = "kafka.enabled", havingValue = "true", matchIfMissing = true)
public class KafkaConfig {

    /** Suffix per the event catalog: dead-letters go to <topic>.dlq. */
    public static final String DLQ_SUFFIX = ".dlq";

    private final KafkaTopicsProperties props;

    /**
     * NewTopic beans are picked up by the auto-configured KafkaAdmin on startup.
     * Creation is idempotent; existing topics are left untouched.
     */
    @Bean
    public NewTopic measurementIngestedTopic() {
        return TopicBuilder.name(props.getTopics().getMeasurementIngested())
                .partitions(props.getTopicDefaults().getPartitions())
                .replicas(props.getTopicDefaults().getReplicas())
                .build();
    }

    /**
     * Must have at least as many partitions as the source topic because the
     * recoverer publishes dead letters to the failed record's original partition.
     */
    @Bean
    public NewTopic measurementIngestedDlqTopic() {
        return TopicBuilder.name(props.getTopics().getMeasurementIngested() + DLQ_SUFFIX)
                .partitions(props.getTopicDefaults().getPartitions())
                .replicas(props.getTopicDefaults().getReplicas())
                .build();
    }

    /**
     * Compacted rule-config projection topic, owned by core (the rule owner).
     * The analytics evaluator replays it to rebuild its rule state
     * (event-carried state transfer, mirror of device.configured).
     */
    @Bean
    public NewTopic ruleConfiguredTopic() {
        return TopicBuilder.name(props.getTopics().getRuleConfigured())
                .partitions(props.getTopicDefaults().getPartitions())
                .replicas(props.getTopicDefaults().getReplicas())
                .compact()
                .build();
    }

    /**
     * Compacted anomaly-rule projection topic, owned by core (the rule
     * owner). The analytics anomaly engine replays it to rebuild its rule
     * state, mirror of rule.configured.
     */
    @Bean
    public NewTopic anomalyRuleConfiguredTopic() {
        return TopicBuilder.name(props.getTopics().getAnomalyRuleConfigured())
                .partitions(props.getTopicDefaults().getPartitions())
                .replicas(props.getTopicDefaults().getReplicas())
                .compact()
                .build();
    }

    /**
     * DLQs for core's detection-event subscriptions. Per the event catalog a
     * consumer owns the DLQs of its own subscriptions; the source topics
     * (threshold.breached, anomaly.detected) are provisioned by their
     * producer, the analytics service.
     */
    @Bean
    public NewTopic thresholdBreachedDlqTopic() {
        return TopicBuilder.name(props.getTopics().getThresholdBreached() + DLQ_SUFFIX)
                .partitions(props.getTopicDefaults().getPartitions())
                .replicas(props.getTopicDefaults().getReplicas())
                .build();
    }

    @Bean
    public NewTopic anomalyDetectedDlqTopic() {
        return TopicBuilder.name(props.getTopics().getAnomalyDetected() + DLQ_SUFFIX)
                .partitions(props.getTopicDefaults().getPartitions())
                .replicas(props.getTopicDefaults().getReplicas())
                .build();
    }

    /**
     * Error handling for all @KafkaListener containers (picked up by Boot's
     * container factory auto-configuration): two retries with 1s backoff for
     * transient failures, then the record is published to <topic>.dlq.
     * IllegalArgumentException (undecodable protobuf) skips the retries.
     */
    @Bean
    public DefaultErrorHandler kafkaErrorHandler(KafkaTemplate<Object, Object> dlqTemplate) {
        var recoverer = new DeadLetterPublishingRecoverer(dlqTemplate,
                (record, ex) -> new TopicPartition(record.topic() + DLQ_SUFFIX, record.partition()));
        var handler = new DefaultErrorHandler(recoverer, new FixedBackOff(1000L, 2L));
        handler.addNotRetryableExceptions(IllegalArgumentException.class);
        return handler;
    }
}
