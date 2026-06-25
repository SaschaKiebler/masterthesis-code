package com.digitaldemon.core.device;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.Data;

import java.time.Instant;

@Data
public class CapturedMessage {
    private final String topic;
    private final String rawPayload;
    private final JsonNode parsedPayload; // null if not valid JSON
    private final Instant timestamp;

    public CapturedMessage(String topic, String rawPayload, JsonNode parsedPayload) {
        this.topic = topic;
        this.rawPayload = rawPayload;
        this.parsedPayload = parsedPayload;
        this.timestamp = Instant.now();
    }
}
