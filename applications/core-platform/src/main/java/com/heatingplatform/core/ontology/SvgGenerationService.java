package com.heatingplatform.core.ontology;

import com.heatingplatform.core.common.StorageService;

import com.heatingplatform.core.ontology.SvgGenerationProperties;
import com.heatingplatform.core.ontology.ObjectType;
import com.heatingplatform.core.ontology.ObjectTypeRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * SvgGenerationService — generates P&ID-style SVG icons for object types
 * via an n8n webhook, uploads the result to GCS, and saves the URL
 * on the ObjectType entity.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class SvgGenerationService {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final SvgGenerationProperties properties;
    private final StorageService storageService;
    private final ObjectTypeRepository objectTypeRepository;

    public record SvgGenerationResult(
        String svgIconUrl,
        String objectTypeName
    ) {}

    /**
     * Generate an SVG icon for the given object type.
     * Calls n8n webhook → gets SVG content → uploads to GCS → saves URL on ObjectType.
     */
    @Transactional
    public SvgGenerationResult generate(UUID objectTypeId) {
        if (properties.getWebhookUrl() == null || properties.getWebhookUrl().isBlank()) {
            throw new IllegalStateException("SVG generation is not configured (webhook URL is empty)");
        }

        ObjectType objectType = objectTypeRepository.findById(objectTypeId)
            .orElseThrow(() -> new IllegalArgumentException("ObjectType not found: " + objectTypeId));

        log.info("Generating SVG icon for object type: {} ({})", objectType.getName(), objectTypeId);

        // Build payload for n8n
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("objectTypeName", objectType.getName());
        payload.put("objectTypeDisplayName", objectType.getDisplayName());
        payload.put("category", objectType.getCategory());
        payload.put("description", objectType.getDescription());
        payload.put("icon", objectType.getIcon());
        payload.put("instructions", "Generate a clean, minimal P&ID (Piping and Instrumentation Diagram) "
            + "style SVG icon for this object type. The SVG should be 80x80 pixels, use a single stroke color "
            + "#64748b on transparent background, 2px stroke width, and represent the equipment/component "
            + "in a technical schematic style. Return ONLY the raw SVG markup, no wrapping.");

        // Call n8n webhook
        String svgContent = callWebhook(payload);

        // Clean up SVG content (n8n might wrap it in JSON or add extra whitespace)
        svgContent = extractSvg(svgContent);

        // Upload to GCS
        String gcsPath = "icons/object-types/" + objectType.getName().toLowerCase() + ".svg";
        String url;
        if (storageService.isConfigured()) {
            url = storageService.upload(gcsPath, svgContent.getBytes(StandardCharsets.UTF_8), "image/svg+xml");
        } else {
            // Fallback: store as data URI when GCS is not configured
            String encoded = java.util.Base64.getEncoder().encodeToString(svgContent.getBytes(StandardCharsets.UTF_8));
            url = "data:image/svg+xml;base64," + encoded;
            log.warn("GCS not configured, storing SVG as data URI for {}", objectType.getName());
        }

        // Save URL on ObjectType
        objectType.setSvgIconUrl(url);
        objectType.setUpdatedAt(Instant.now());
        objectTypeRepository.save(objectType);

        log.info("SVG icon generated and saved for {}: {}", objectType.getName(), url);
        return new SvgGenerationResult(url, objectType.getName());
    }

    private String callWebhook(Map<String, Object> payload) {
        String bodyJson;
        try {
            bodyJson = MAPPER.writeValueAsString(payload);
        } catch (Exception e) {
            throw new RuntimeException("Failed to serialize n8n request payload", e);
        }

        HttpClient client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();

        HttpRequest.Builder requestBuilder = HttpRequest.newBuilder()
            .uri(URI.create(properties.getWebhookUrl()))
            .timeout(Duration.ofSeconds(properties.getTimeoutSeconds()))
            .header("Content-Type", "application/json");

        String token = properties.getWebhookToken();
        if (token != null && !token.isBlank()) {
            requestBuilder.header("Authorization", "Bearer " + token);
        }

        HttpRequest request = requestBuilder
            .POST(HttpRequest.BodyPublishers.ofString(bodyJson))
            .build();

        HttpResponse<String> response;
        try {
            response = client.send(request, HttpResponse.BodyHandlers.ofString());
        } catch (Exception e) {
            throw new RuntimeException("n8n SVG generation webhook call failed: " + e.getMessage(), e);
        }

        int statusCode = response.statusCode();
        if (statusCode < 200 || statusCode >= 300) {
            throw new RuntimeException(
                "n8n webhook returned non-2xx status " + statusCode + ": " + response.body());
        }

        return response.body();
    }

    /**
     * Extract raw SVG content from the n8n response.
     * The response might be raw SVG, or JSON-wrapped.
     */
    private String extractSvg(String raw) {
        String trimmed = raw.trim();

        // If it starts with <svg, it's already raw SVG
        if (trimmed.startsWith("<svg") || trimmed.startsWith("<?xml")) {
            return trimmed;
        }

        // Try to parse as JSON and extract an "svg" field
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> parsed = MAPPER.readValue(trimmed, Map.class);
            Object svg = parsed.get("svg");
            if (svg instanceof String s && !s.isBlank()) {
                return s.trim();
            }
            // Try "content" field
            Object content = parsed.get("content");
            if (content instanceof String s && !s.isBlank()) {
                return s.trim();
            }
        } catch (Exception ignored) {
            // Not JSON, try to find SVG in the raw string
        }

        // Try to extract SVG tag from mixed content
        int svgStart = trimmed.indexOf("<svg");
        int svgEnd = trimmed.lastIndexOf("</svg>");
        if (svgStart >= 0 && svgEnd > svgStart) {
            return trimmed.substring(svgStart, svgEnd + "</svg>".length());
        }

        throw new IllegalArgumentException("Could not extract SVG from n8n response: " + trimmed.substring(0, Math.min(200, trimmed.length())));
    }
}
