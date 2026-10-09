package com.heatingplatform.core.analysis;

import com.heatingplatform.core.dashboard.DashboardAiProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;

/**
 * AnalysisAiService — sends chart screenshot + metadata to an n8n webhook
 * for AI-powered interpretation (Claude vision analysis).
 *
 * Reuses the same n8n webhook configuration as dashboard-ai but calls
 * a different n8n workflow path for analysis interpretation.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class AnalysisAiService {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private final DashboardAiProperties aiProperties;

    /**
     * Send a chart image + metadata to the n8n analysis webhook.
     *
     * @param imageBase64 PNG image as base64 string (no data: prefix)
     * @param metadata    chart context (title, type, sensors, time range, calculations)
     * @return parsed JSON response from n8n (analysis text + recommendations)
     */
    public Map<String, Object> analyzeChart(String imageBase64, Map<String, Object> metadata) {
        String webhookUrl = aiProperties.getWebhookUrl();
        if (webhookUrl == null || webhookUrl.isBlank()) {
            throw new IllegalStateException("Analysis AI is not configured — set dashboard-ai.n8n.webhook-url");
        }

        // Use the same base URL but append /analysis path
        String analysisUrl = webhookUrl.replaceAll("/+$", "") + "-analysis";

        Map<String, Object> payload = Map.of(
            "type", "chart_analysis",
            "image", imageBase64,
            "metadata", metadata
        );

        try {
            String jsonPayload = MAPPER.writeValueAsString(payload);

            HttpRequest.Builder requestBuilder = HttpRequest.newBuilder()
                .uri(URI.create(analysisUrl))
                .header("Content-Type", "application/json")
                .timeout(Duration.ofSeconds(aiProperties.getTimeoutSeconds()))
                .POST(HttpRequest.BodyPublishers.ofString(jsonPayload));

            String token = aiProperties.getWebhookToken();
            if (token != null && !token.isBlank()) {
                requestBuilder.header("Authorization", "Bearer " + token);
            }

            HttpClient client = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .build();

            log.info("Sending chart analysis to n8n: {} ({} bytes image, {} metadata keys)",
                    analysisUrl, imageBase64.length(), metadata.size());

            HttpResponse<String> response = client.send(requestBuilder.build(), HttpResponse.BodyHandlers.ofString());

            if (response.statusCode() >= 400) {
                log.error("n8n analysis webhook returned {}: {}", response.statusCode(), response.body());
                throw new RuntimeException("AI analysis webhook returned " + response.statusCode());
            }

            @SuppressWarnings("unchecked")
            Map<String, Object> result = MAPPER.readValue(response.body(), Map.class);
            log.info("Chart analysis completed successfully");
            return result;

        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new RuntimeException("AI analysis interrupted", e);
        } catch (IllegalStateException e) {
            throw e;
        } catch (Exception e) {
            log.error("Chart analysis failed", e);
            throw new RuntimeException("AI analysis failed: " + e.getMessage(), e);
        }
    }
}
