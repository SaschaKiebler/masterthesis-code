package com.digitaldemon.core.dashboard;

import com.digitaldemon.core.common.exception.ResourceNotFoundException;
import com.digitaldemon.core.common.exception.ValidationException;
import com.digitaldemon.core.dashboard.DashboardAiService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * DashboardAiController — REST API for the AI-assisted dashboard builder.
 *
 * <p>Exposes a single conversational endpoint that accepts a message history and
 * returns the AI's next response (widget suggestions, clarifying questions, etc.)
 * directly from the n8n workflow without transformation.
 *
 * Endpoints:
 * <pre>
 *   POST /api/v1/projects/{projectId}/dashboard-ai/converse  — continue or start a conversation
 * </pre>
 */
@Slf4j
@RestController
@RequiredArgsConstructor
public class DashboardAiController {

    private final DashboardAiService dashboardAiService;

    // ── Converse ──────────────────────────────────────────────────────────────

    /**
     * POST /api/v1/projects/{projectId}/dashboard-ai/converse
     *
     * <p>Continue or start an AI dashboard-building conversation scoped to a project.
     * The full message history (user and assistant turns) must be included on every
     * request so the AI can maintain context across multiple turns.
     *
     * <p>Request body:
     * <pre>
     * {
     *   "messages": [
     *     { "role": "user",      "content": "Create a dashboard for my heating circuit" },
     *     { "role": "assistant", "content": "..." },
     *     { "role": "user",      "content": "Add a gauge for the supply temperature" }
     *   ]
     * }
     * </pre>
     *
     * <p>Returns the raw JSON map from the n8n workflow.
     * Returns 503 when the AI feature is not configured, 404 when the project does not exist,
     * 400 on validation errors, and 500 on unexpected failures.
     */
    @PostMapping("/api/v1/projects/{projectId}/dashboard-ai/converse")
    public ResponseEntity<?> converse(@PathVariable String projectId,
                                       @RequestBody Map<String, Object> body) {
        log.info("POST /api/v1/projects/{}/dashboard-ai/converse", projectId);

        UUID projId = parseUUID(projectId, "project ID");

        List<DashboardAiService.ConversationMessage> messages = extractMessages(body);
        if (messages.isEmpty()) {
            return ResponseEntity.badRequest()
                    .body(Map.of("message", "'messages' must contain at least one entry"));
        }

        try {
            Map<String, Object> result = dashboardAiService.converse(projId, messages);
            return ResponseEntity.ok(result);
        } catch (IllegalStateException e) {
            // Webhook URL not configured
            return ResponseEntity.status(503).body(Map.of("message", e.getMessage()));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        } catch (Exception e) {
            log.error("Dashboard AI converse failed for project {}", projectId, e);
            return ResponseEntity.internalServerError().body(Map.of("message", e.getMessage()));
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private UUID parseUUID(String value, String fieldName) {
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException e) {
            throw new ValidationException("Invalid " + fieldName + ": " + value);
        }
    }

    /**
     * Extract and convert the {@code messages} array from the request body.
     *
     * <p>Each element is expected to be a Map with {@code role} and {@code content} string fields.
     * Entries missing either field are silently skipped.
     */
    @SuppressWarnings("unchecked")
    private List<DashboardAiService.ConversationMessage> extractMessages(Map<String, Object> body) {
        Object raw = body.get("messages");
        if (!(raw instanceof List<?> rawList)) {
            return List.of();
        }

        return rawList.stream()
                .filter(item -> item instanceof Map)
                .map(item -> (Map<String, Object>) item)
                .filter(m -> m.get("role") instanceof String && m.get("content") instanceof String)
                .map(m -> new DashboardAiService.ConversationMessage(
                        (String) m.get("role"),
                        (String) m.get("content")))
                .toList();
    }
}
