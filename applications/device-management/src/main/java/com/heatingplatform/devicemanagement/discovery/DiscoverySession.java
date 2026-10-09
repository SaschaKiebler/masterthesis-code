package com.heatingplatform.devicemanagement.discovery;

import lombok.Data;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedQueue;

@Data
public class DiscoverySession {

    public enum Status { LISTENING, STOPPED, TIMED_OUT }

    private final UUID sessionId;
    private final String deviceId;
    private final UUID tenantId;
    private volatile Status status;
    private final ConcurrentLinkedQueue<CapturedMessage> messages = new ConcurrentLinkedQueue<>();
    private final ConcurrentHashMap<String, Integer> topicCounts = new ConcurrentHashMap<>();
    private static final int MAX_MESSAGES_PER_TOPIC = 3;
    private final Instant startedAt;
    private volatile Instant stoppedAt;

    public DiscoverySession(String deviceId, UUID tenantId) {
        this.sessionId = UUID.randomUUID();
        this.deviceId = deviceId;
        this.tenantId = tenantId;
        this.status = Status.LISTENING;
        this.startedAt = Instant.now();
    }

    /**
     * Add a message, enforcing max 3 messages per unique topic to prevent
     * high-frequency topics from flooding the capture budget.
     * @return true if the message was added, false if skipped due to topic limit
     */
    public boolean addMessage(CapturedMessage message) {
        int count = topicCounts.merge(message.getTopic(), 1, Integer::sum);
        if (count > MAX_MESSAGES_PER_TOPIC) {
            topicCounts.merge(message.getTopic(), -1, Integer::sum);
            return false;
        }
        messages.add(message);
        return true;
    }

    public int getUniqueTopicCount() {
        return topicCounts.size();
    }

    public List<CapturedMessage> getMessageList() {
        return new ArrayList<>(messages);
    }

    public int getMessageCount() {
        return messages.size();
    }

    public void stop() {
        this.status = Status.STOPPED;
        this.stoppedAt = Instant.now();
    }

    public void timeout() {
        this.status = Status.TIMED_OUT;
        this.stoppedAt = Instant.now();
    }
}
