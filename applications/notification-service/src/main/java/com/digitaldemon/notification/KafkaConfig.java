package com.digitaldemon.notification;

import lombok.RequiredArgsConstructor;
import org.apache.kafka.clients.admin.NewTopic;
import org.apache.kafka.common.TopicPartition;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.config.TopicBuilder;
import org.springframework.kafka.core.KafkaAdmin;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.listener.DeadLetterPublishingRecoverer;
import org.springframework.kafka.listener.DefaultErrorHandler;
import org.springframework.util.backoff.FixedBackOff;

/**
 * Consumer-side Kafka wiring: this service owns the dead-letter topics of
 * its own subscriptions (<topic>.dlq per the event catalog); the detection
 * topics themselves are provisioned by their producers.
 */
@Configuration
@RequiredArgsConstructor
public class KafkaConfig {

    public static final String DLQ_SUFFIX = ".dlq";

    private final NotificationProperties props;

    /**
     * One .dlq per subscribed detection topic, same partition count as the
     * source because the recoverer targets the failed record's partition.
     */
    @Bean
    public KafkaAdmin.NewTopics detectionDlqTopics() {
        NewTopic[] dlqs = props.getTopics().stream()
                .map(topic -> TopicBuilder.name(topic + DLQ_SUFFIX)
                        .partitions(props.getTopicDefaults().getPartitions())
                        .replicas(props.getTopicDefaults().getReplicas())
                        .build())
                .toArray(NewTopic[]::new);
        return new KafkaAdmin.NewTopics(dlqs);
    }

    /**
     * Two retries with 1s backoff for transient failures, then the record is
     * published to <topic>.dlq. Undecodable envelopes skip the retries.
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
