package com.heatingplatform.core.analysis;

import com.heatingplatform.core.analysis.AnalysisAiService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * AnalysisAiController — sends chart screenshot + metadata to n8n for AI interpretation.
 *
 * Endpoint:
 *   POST /api/v1/analysis-ai/analyze  — analyze a chart image with AI
 */
@Slf4j
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class AnalysisAiController {

    private final AnalysisAiService analysisAiService;

    @SuppressWarnings("unchecked")
    @PostMapping("/analysis-ai/analyze")
    public ResponseEntity<?> analyzeChart(@RequestBody Map<String, Object> body) {
        log.info("POST /api/v1/analysis-ai/analyze");

        String image = (String) body.get("image");
        if (image == null || image.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("message", "image (base64) is required"));
        }

        Map<String, Object> metadata = Map.of();
        if (body.get("metadata") instanceof Map) {
            metadata = (Map<String, Object>) body.get("metadata");
        }

        try {
            Map<String, Object> result = analysisAiService.analyzeChart(image, metadata);
            return ResponseEntity.ok(result);
        } catch (IllegalStateException e) {
            return ResponseEntity.status(503).body(Map.of("message", e.getMessage()));
        } catch (Exception e) {
            log.error("Analysis AI failed", e);
            return ResponseEntity.internalServerError().body(Map.of("message", e.getMessage()));
        }
    }
}
