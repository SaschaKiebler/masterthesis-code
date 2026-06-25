package com.digitaldemon.core.kpiformula;

import com.digitaldemon.core.ontology.OntologyService;
import com.digitaldemon.core.project.ProjectService;

import com.digitaldemon.core.kpiformula.KpiFormulaAiProperties;
import com.digitaldemon.core.ontology.ObjectEntity;
import com.digitaldemon.core.metricpoint.MetricPointRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * KpiFormulaGenerationService — AI-assisted KPI formula generation via an n8n webhook.
 *
 * <p>Given an ontology object anchor, a user-supplied natural-language prompt, and an optional
 * project scope, this service:
 * <ol>
 *   <li>Loads the anchor object to obtain its type and display name for context.</li>
 *   <li>Collects all metric points visible within the project scope (or an empty set when no
 *       project is given) and shapes them into an AI-friendly payload.</li>
 *   <li>POSTs the payload to the configured n8n webhook URL and parses the structured response
 *       into a {@link KpiFormulaGenerationResult}.</li>
 * </ol>
 *
 * <p>The n8n call is synchronous/blocking. The timeout is controlled by
 * {@link KpiFormulaAiProperties#getTimeoutSeconds()}.
 *
 * <p>Throws {@link IllegalStateException} when the webhook URL is not configured.
 */
@Service
@RequiredArgsConstructor
@Slf4j
@Transactional(readOnly = true)
public class KpiFormulaGenerationService {

    // Static ObjectMapper — consistent with the pattern used by KpiFormulaController and
    // RegistryController; avoids a Spring bean dependency on com.fasterxml.jackson.databind.ObjectMapper
    // which is not registered as a bean in this application context.
    private static final ObjectMapper MAPPER = new ObjectMapper();

    // ── Column indices for MetricPointRepository.findEnrichedByObjectIds ──────
    // [0]  mp.id            [1]  mp.device_id       [2]  mp.metric_id
    // [3]  mp.source        [4]  mp.field            [5]  mp.unit
    // [6]  mp.min_value     [7]  mp.max_value        [8]  mp.quantity_id
    // [9]  mp.sample_interval_seconds
    // [10] mp_obj.display_name   [11] asset_obj.id   [12] asset_obj.display_name
    // [13] asset_type.name       [14] pq.name        [15] pq.display_name
    // [16] pq.dimension          [17] pq.default_unit
    private static final int COL_ID            = 0;
    private static final int COL_UNIT          = 5;
    private static final int COL_MP_NAME       = 10;
    private static final int COL_ASSET_NAME    = 12;
    private static final int COL_ASSET_TYPE    = 13;
    private static final int COL_QUANTITY_NAME = 14;

    // ── Dependencies ──────────────────────────────────────────────────────────

    private final KpiFormulaAiProperties properties;
    private final OntologyService ontologyService;
    private final ProjectService projectService;
    private final MetricPointRepository metricPointRepository;

    // ── Result record ─────────────────────────────────────────────────────────

    /**
     * Structured result returned from the n8n AI workflow and passed through to the API layer.
     *
     * @param displayName  Human-readable formula label suggested by the AI
     * @param name         Machine key (snake_case) suggested by the AI
     * @param formula      exp4j-compatible expression string
     * @param unit         Physical unit of the formula result
     * @param explanation  Plain-text explanation of the formula logic
     * @param confidence   0.0–1.0 confidence score from the AI model
     * @param variables    Variable binding map (pass-through; structure matches KpiFormula.variables JSON)
     */
    public record KpiFormulaGenerationResult(
            String displayName,
            String name,
            String formula,
            String unit,
            String explanation,
            double confidence,
            Object variables
    ) {}

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Generate a KPI formula suggestion via the n8n AI webhook.
     *
     * @param objectId  UUID of the ontology object that will anchor the formula
     * @param projectId Optional project UUID; when present, metric points from the full project
     *                  object graph are included in the AI prompt context
     * @param prompt    Natural-language description of what the formula should compute
     * @return structured AI response
     * @throws IllegalStateException     when the webhook URL is not configured
     * @throws IllegalArgumentException  when the n8n response cannot be parsed
     * @throws RuntimeException          when the HTTP call fails or returns a non-2xx status
     */
    public KpiFormulaGenerationResult generate(UUID objectId, UUID projectId, String prompt) {
        validateConfiguration();

        log.info("Generating KPI formula for object={} project={}", objectId, projectId);

        ObjectEntity object = ontologyService.getObject(objectId);
        String objectTypeName    = object.getObjectType().getName();
        String objectDisplayName = object.getDisplayName();

        List<Object[]> metricRows = loadMetricRows(projectId);
        Map<String, Object> payload = buildPayload(prompt, objectTypeName, objectDisplayName, metricRows);

        log.debug("Calling n8n KPI formula webhook: {} metric rows in context", metricRows.size());
        Map<String, Object> responseMap = callWebhook(payload);

        return parseResult(responseMap);
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    /**
     * Guard: fail fast when the feature is not configured rather than making a confused HTTP call.
     */
    private void validateConfiguration() {
        String url = properties.getWebhookUrl();
        if (url == null || url.isBlank()) {
            throw new IllegalStateException("AI generation is not configured");
        }
    }

    /**
     * Load enriched metric point rows scoped to the project, or an empty list when no project
     * is specified.
     */
    private List<Object[]> loadMetricRows(UUID projectId) {
        if (projectId == null) {
            return List.of();
        }
        // collectProjectObjectIds throws ResourceNotFoundException when the project is absent —
        // let it propagate so the controller can return 404.
        Set<UUID> objectIds = projectService.collectProjectObjectIds(projectId);
        if (objectIds.isEmpty()) {
            return List.of();
        }
        return metricPointRepository.findEnrichedByObjectIds(objectIds);
    }

    /**
     * Build the JSON payload map that will be sent to the n8n webhook.
     */
    private Map<String, Object> buildPayload(String prompt,
                                              String objectTypeName,
                                              String objectDisplayName,
                                              List<Object[]> metricRows) {
        List<Map<String, Object>> metricPoints = new ArrayList<>(metricRows.size());
        List<String> quantityNames = new ArrayList<>();

        for (Object[] row : metricRows) {
            Map<String, Object> mp = new LinkedHashMap<>();
            mp.put("id",            safeString(row[COL_ID]));
            mp.put("displayName",   safeString(row[COL_MP_NAME]));
            mp.put("quantityName",  safeString(row[COL_QUANTITY_NAME]));
            mp.put("unit",          safeString(row[COL_UNIT]));
            mp.put("assetName",     safeString(row[COL_ASSET_NAME]));
            mp.put("assetTypeName", safeString(row[COL_ASSET_TYPE]));
            metricPoints.add(mp);

            String qName = safeString(row[COL_QUANTITY_NAME]);
            if (qName != null) {
                quantityNames.add(qName);
            }
        }

        // Deduplicate and sort for deterministic AI context
        List<String> availableQuantities = quantityNames.stream()
                .distinct()
                .sorted()
                .collect(Collectors.toList());

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("prompt",            prompt);
        payload.put("objectTypeName",    objectTypeName);
        payload.put("objectDisplayName", objectDisplayName);
        payload.put("metricPoints",      metricPoints);
        payload.put("availableQuantities", availableQuantities);
        return payload;
    }

    /**
     * POST the payload JSON to the n8n webhook and return the parsed response map.
     * A new {@link HttpClient} is built per call — stateless, no connection pooling concerns.
     */
    private Map<String, Object> callWebhook(Map<String, Object> payload) {
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
            log.info("n8n auth: sending Bearer token ({}...{})", token.substring(0, Math.min(4, token.length())), token.substring(Math.max(0, token.length() - 4)));
        } else {
            log.warn("n8n auth: NO token configured — request will be sent without Authorization header");
        }

        HttpRequest request = requestBuilder
                .POST(HttpRequest.BodyPublishers.ofString(bodyJson))
                .build();

        HttpResponse<String> response;
        try {
            response = client.send(request, HttpResponse.BodyHandlers.ofString());
        } catch (Exception e) {
            throw new RuntimeException("n8n webhook call failed: " + e.getMessage(), e);
        }

        int statusCode = response.statusCode();
        if (statusCode < 200 || statusCode >= 300) {
            throw new RuntimeException(
                    "n8n webhook returned non-2xx status " + statusCode + ": " + response.body());
        }

        log.debug("n8n webhook responded with status {}", statusCode);

        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> parsed = MAPPER.readValue(response.body(), Map.class);
            return parsed;
        } catch (Exception e) {
            throw new IllegalArgumentException(
                    "Failed to parse n8n response as JSON object: " + e.getMessage(), e);
        }
    }

    /**
     * Map the raw n8n response map to a typed {@link KpiFormulaGenerationResult}.
     * All fields default gracefully when the AI omits them.
     */
    private KpiFormulaGenerationResult parseResult(Map<String, Object> map) {
        String displayName  = safeString(map.get("displayName"));
        String name         = safeString(map.get("name"));
        String formula      = safeString(map.get("formula"));
        String unit         = safeString(map.get("unit"));
        String explanation  = safeString(map.get("explanation"));
        double confidence   = map.get("confidence") instanceof Number n ? n.doubleValue() : 0.0;
        Object variables    = map.get("variables");

        return new KpiFormulaGenerationResult(
                displayName, name, formula, unit, explanation, confidence, variables);
    }

    /**
     * Convert an arbitrary column value to its String representation, or null when absent.
     */
    private static String safeString(Object value) {
        if (value == null) return null;
        return value.toString();
    }
}
