package com.digitaldemon.notification.delivery;

import com.digitaldemon.detection.proto.v1.DetectionEvent;
import com.digitaldemon.notification.NotificationProperties;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Delivers an alert to the configured channels.
 *
 * Always writes a structured ALERT log line (the baseline channel, also what
 * the E2E checks assert on). When a webhook URL is configured, additionally
 * POSTs the alert as JSON — the n8n path from the event catalog. A webhook
 * failure is logged but never thrown: the alert reached the log channel and
 * a retry storm against a dead webhook would only delay newer alerts.
 */
@Slf4j
@Component
public class AlertDeliverer {

    private final NotificationProperties props;
    private final RestClient webhookClient;

    public AlertDeliverer(NotificationProperties props) {
        this.props = props;
        this.webhookClient = RestClient.builder().build();
    }

    public void deliver(DetectionEvent event) {
        Instant detectedAt = event.hasDetectedAt()
                ? Instant.ofEpochSecond(event.getDetectedAt().getSeconds(), event.getDetectedAt().getNanos())
                : Instant.now();

        log.info("ALERT [{}] {} device={} metric={} assetRef={} detectedAt={} detail={}",
                event.getSeverity(), event.getType(),
                event.getChannel().getDeviceId(), event.getChannel().getMetricId(),
                event.getAssetRef(), detectedAt, event.getDetail());

        String url = props.getWebhook().getUrl();
        if (url == null || url.isBlank()) {
            return;
        }

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("type", event.getType());
        body.put("severity", event.getSeverity());
        body.put("deviceId", event.getChannel().getDeviceId());
        body.put("metricId", event.getChannel().getMetricId());
        body.put("assetRef", event.getAssetRef());
        body.put("detectedAt", detectedAt.toString());
        body.put("detail", event.getDetail());

        try {
            var request = webhookClient.post()
                    .uri(url)
                    .contentType(MediaType.APPLICATION_JSON);
            String token = props.getWebhook().getToken();
            if (token != null && !token.isBlank()) {
                request = request.header("Authorization", "Bearer " + token);
            }
            request.body(body).retrieve().toBodilessEntity();
            log.debug("Alert forwarded to webhook for device={}", event.getChannel().getDeviceId());
        } catch (Exception e) {
            log.warn("Webhook delivery failed for device={}: {}",
                    event.getChannel().getDeviceId(), e.getMessage());
        }
    }
}
