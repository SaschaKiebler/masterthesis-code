package com.digitaldemon.core.dashboard;

import com.digitaldemon.core.project.ProjectService;

import com.digitaldemon.core.dashboard.DashboardAiProperties;
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
 * DashboardAiService — AI-assisted dashboard building via an n8n webhook.
 *
 * <p>Given a project scope and a conversational message history, this service:
 * <ol>
 *   <li>Collects all metric points visible within the project object graph and shapes
 *       them into an AI-friendly context payload.</li>
 *   <li>Enriches the payload with the available widget types and their configuration
 *       schema summaries so the AI can make informed widget suggestions.</li>
 *   <li>POSTs the payload — including the full conversation history — to the configured
 *       n8n webhook URL and passes the raw structured response back to the caller.</li>
 * </ol>
 *
 * <p>The n8n call is synchronous/blocking. The timeout is controlled by
 * {@link DashboardAiProperties#getTimeoutSeconds()}.
 *
 * <p>Throws {@link IllegalStateException} when the webhook URL is not configured.
 */
@Service
@RequiredArgsConstructor
@Slf4j
@Transactional(readOnly = true)
public class DashboardAiService {

    // Static ObjectMapper — consistent with the pattern used across gateway and service layer.
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
    private static final int COL_METRIC_ID     = 2;
    private static final int COL_UNIT          = 5;
    private static final int COL_MP_NAME       = 10;
    private static final int COL_ASSET_ID      = 11;
    private static final int COL_ASSET_NAME    = 12;
    private static final int COL_ASSET_TYPE    = 13;
    private static final int COL_QUANTITY_NAME = 14;

    /**
     * Static widget type catalogue sent to the AI as context.
     * Each entry describes the widget type identifier and the key configuration fields
     * the dashboard builder must supply to instantiate that widget.
     */
    private static final List<Map<String, Object>> WIDGET_TYPES = buildWidgetTypes();

    // ── Dependencies ──────────────────────────────────────────────────────────

    private final DashboardAiProperties properties;
    private final ProjectService projectService;
    private final MetricPointRepository metricPointRepository;

    // ── Conversation message record ───────────────────────────────────────────

    /**
     * A single turn in the user–assistant conversation sent to the AI webhook.
     *
     * @param role    Either {@code "user"} or {@code "assistant"}
     * @param content The message text
     */
    public record ConversationMessage(String role, String content) {}

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Continue or start an AI dashboard-building conversation for the given project.
     *
     * <p>The full {@code messages} history (user + assistant turns) is forwarded to the n8n
     * workflow so the AI can maintain context across multiple turns.
     *
     * @param projectId UUID of the project whose metric points are included as AI context
     * @param messages  Full conversation history; must contain at least one user message
     * @return raw response map from the n8n webhook — passed through without transformation
     * @throws IllegalStateException    when the webhook URL is not configured
     * @throws IllegalArgumentException when the n8n response cannot be parsed as JSON
     * @throws RuntimeException         when the HTTP call fails or returns a non-2xx status
     */
    public Map<String, Object> converse(UUID projectId, List<ConversationMessage> messages) {
        validateConfiguration();

        log.info("Dashboard AI converse: project={}, turns={}", projectId, messages.size());

        List<Object[]> metricRows = loadMetricRows(projectId);
        Map<String, Object> payload = buildPayload(messages, metricRows);

        log.debug("Calling n8n Dashboard AI webhook: {} metric rows in context", metricRows.size());
        return callWebhook(payload);
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    /**
     * Guard: fail fast when the feature is not configured rather than making a confused HTTP call.
     */
    private void validateConfiguration() {
        String url = properties.getWebhookUrl();
        if (url == null || url.isBlank()) {
            throw new IllegalStateException("AI dashboard builder is not configured");
        }
    }

    /**
     * Load enriched metric point rows scoped to the project's object graph.
     * Returns an empty list when the project has no objects.
     */
    private List<Object[]> loadMetricRows(UUID projectId) {
        // collectProjectObjectIds throws ResourceNotFoundException when the project is absent —
        // let it propagate so the controller can return 404.
        Set<UUID> objectIds = projectService.collectProjectObjectIds(projectId);
        if (objectIds.isEmpty()) {
            return List.of();
        }
        return metricPointRepository.findEnrichedByObjectIds(objectIds);
    }

    /**
     * Build the JSON payload map sent to the n8n webhook.
     *
     * <p>The payload contains:
     * <ul>
     *   <li>{@code messages} — full conversation history</li>
     *   <li>{@code metricPoints} — enriched metric point descriptors for all project objects</li>
     *   <li>{@code availableQuantities} — deduplicated, sorted list of physical quantity names</li>
     *   <li>{@code widgetTypes} — static catalogue of supported widget types and their config keys</li>
     * </ul>
     */
    private Map<String, Object> buildPayload(List<ConversationMessage> messages,
                                              List<Object[]> metricRows) {
        List<Map<String, Object>> metricPoints = new ArrayList<>(metricRows.size());
        List<String> quantityNames = new ArrayList<>();

        for (Object[] row : metricRows) {
            Map<String, Object> mp = new LinkedHashMap<>();
            mp.put("id",            safeString(row[COL_ID]));
            mp.put("metricId",      row[COL_METRIC_ID]);
            mp.put("displayName",   safeString(row[COL_MP_NAME]));
            mp.put("quantityName",  safeString(row[COL_QUANTITY_NAME]));
            mp.put("unit",          safeString(row[COL_UNIT]));
            mp.put("assetId",       safeString(row[COL_ASSET_ID]));
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

        // Serialise conversation messages as plain maps for JSON transport
        List<Map<String, String>> messagePayload = messages.stream()
                .map(m -> Map.of("role", m.role(), "content", m.content()))
                .collect(Collectors.toList());

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("messages",            messagePayload);
        payload.put("metricPoints",        metricPoints);
        payload.put("availableQuantities", availableQuantities);
        payload.put("widgetTypes",         WIDGET_TYPES);
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
            log.info("n8n auth: sending Bearer token ({}...{})",
                    token.substring(0, Math.min(4, token.length())),
                    token.substring(Math.max(0, token.length() - 4)));
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
     * Convert an arbitrary column value to its String representation, or null when absent.
     */
    private static String safeString(Object value) {
        if (value == null) return null;
        return value.toString();
    }

    // ── Widget type catalogue ─────────────────────────────────────────────────

    /**
     * Build the static widget type catalogue that is included in every AI payload.
     *
     * <p>Each entry contains:
     * <ul>
     *   <li>{@code type} — the widget type identifier used in the dashboard config</li>
     *   <li>{@code description} — one-line purpose summary for the AI</li>
     *   <li>{@code configKeys} — required and optional configuration field names</li>
     * </ul>
     */
    private static List<Map<String, Object>> buildWidgetTypes() {
        List<Map<String, Object>> types = new ArrayList<>();

        types.add(widgetType("time_series",
                "Time-series line/area chart for one or more metric point streams",
                List.of("series (array of {assetId, metricPointId, metricId, color, label})", "yAxis", "timePreset", "bucketMinutes (number: 0=all raw data points, 1/5/15/60/360/1440=aggregation in minutes, omit for auto)")));

        types.add(widgetType("gauge",
                "Circular gauge showing the current value of a single metric point",
                List.of("assetId", "metricPointId", "metricId", "title")));

        types.add(widgetType("status",
                "Discrete status indicator driven by a metric point value and state rules",
                List.of("assetId", "metricPointId", "metricId", "states")));

        types.add(widgetType("stat_card",
                "Single large numeric value card with optional unit and transform",
                List.of("assetId", "metricPointId", "metricId", "title", "valueTransform")));

        types.add(widgetType("derived_property",
                "Displays a computed derived property from an ontology object",
                List.of("metricPointId (objectId)", "propertyName", "displayFormat", "thresholds")));

        types.add(widgetType("event_timeline",
                "Scrollable timeline of system events filtered by severity and type",
                List.of("scope", "severityFilter", "eventTypeFilter", "maxItems")));

        types.add(widgetType("comparison",
                "Side-by-side bar comparison of a physical quantity across multiple objects",
                List.of("quantityName", "objectIds")));

        types.add(widgetType("event_log",
                "Tabular log of recent system events",
                List.of("scope", "maxItems")));

        return List.copyOf(types);
    }

    private static Map<String, Object> widgetType(String type, String description,
                                                    List<String> configKeys) {
        Map<String, Object> entry = new LinkedHashMap<>();
        entry.put("type",        type);
        entry.put("description", description);
        entry.put("configKeys",  configKeys);
        return entry;
    }
}
