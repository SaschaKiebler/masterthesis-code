package com.digitaldemon.core.space;

import com.digitaldemon.core.space.SpaceDTO;
import com.digitaldemon.core.common.exception.ResourceNotFoundException;
import com.digitaldemon.core.common.exception.ValidationException;
import com.digitaldemon.core.user.AuthService;
import com.digitaldemon.core.space.SpaceService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@Slf4j
@RestController
@RequestMapping("/api/v1/sites/{siteId}/spaces")
@RequiredArgsConstructor
public class SpaceController {

    private final SpaceService spaceService;
    private final AuthService authService;

    /**
     * GET /api/v1/sites/{siteId}/spaces?view=tree|flat
     * List all spaces for a site. Default: tree view.
     */
    @GetMapping
    public ResponseEntity<?> listSpaces(
            @PathVariable String siteId,
            @RequestParam(defaultValue = "tree") String view) {

        log.info("GET /api/v1/sites/{}/spaces?view={}", siteId, view);

        UUID siteUuid = parseUUID(siteId, "site ID");

        if (!authService.canAccessSite(siteUuid)) {
            return ResponseEntity.status(403).body(Map.of("message", "Access denied to site"));
        }

        List<SpaceDTO> spaces;
        if ("flat".equalsIgnoreCase(view)) {
            spaces = spaceService.getSpacesBySite(siteUuid);
        } else {
            spaces = spaceService.getSpaceTree(siteUuid);
        }

        return ResponseEntity.ok(Map.of("spaces", spaces));
    }

    /**
     * GET /api/v1/sites/{siteId}/spaces/{spaceId}
     * Get a single space by ID.
     */
    @GetMapping("/{spaceId}")
    public ResponseEntity<?> getSpace(
            @PathVariable String siteId,
            @PathVariable String spaceId) {

        log.info("GET /api/v1/sites/{}/spaces/{}", siteId, spaceId);

        UUID siteUuid = parseUUID(siteId, "site ID");
        UUID spaceUuid = parseUUID(spaceId, "space ID");

        if (!authService.canAccessSite(siteUuid)) {
            return ResponseEntity.status(403).body(Map.of("message", "Access denied to site"));
        }

        return spaceService.getSpaceById(spaceUuid)
            .map(space -> ResponseEntity.ok(Map.of("space", (Object) space)))
            .orElse(ResponseEntity.notFound().build());
    }

    /**
     * POST /api/v1/sites/{siteId}/spaces
     * Create a new space within a site.
     */
    @PostMapping
    public ResponseEntity<?> createSpace(
            @PathVariable String siteId,
            @RequestBody Map<String, Object> body) {

        log.info("POST /api/v1/sites/{}/spaces", siteId);

        UUID siteUuid = parseUUID(siteId, "site ID");

        if (!authService.canAccessSite(siteUuid)) {
            return ResponseEntity.status(403).body(Map.of("message", "Access denied to site"));
        }

        try {
            String type = (String) body.get("type");
            String name = (String) body.get("name");
            String parentSpaceIdStr = (String) body.get("parentSpaceId");
            String attributes = body.containsKey("attributes") ? body.get("attributes").toString() : null;

            UUID parentSpaceId = null;
            if (parentSpaceIdStr != null && !parentSpaceIdStr.isBlank()) {
                parentSpaceId = UUID.fromString(parentSpaceIdStr);
            }

            SpaceDTO created = spaceService.createSpace(siteUuid,
                new SpaceService.CreateSpaceRequest(type, name, parentSpaceId, attributes));

            return ResponseEntity.status(201).body(Map.of("space", created));
        } catch (ValidationException e) {
            return ResponseEntity.badRequest().body(Map.of("message", e.getMessage()));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        } catch (Exception e) {
            log.error("Error creating space in site {}: {}", siteId, e.getMessage(), e);
            return ResponseEntity.internalServerError().body(Map.of("message", "Failed to create space"));
        }
    }

    /**
     * PATCH /api/v1/sites/{siteId}/spaces/{spaceId}
     * Update an existing space.
     */
    @PatchMapping("/{spaceId}")
    public ResponseEntity<?> updateSpace(
            @PathVariable String siteId,
            @PathVariable String spaceId,
            @RequestBody Map<String, Object> body) {

        log.info("PATCH /api/v1/sites/{}/spaces/{}", siteId, spaceId);

        UUID siteUuid = parseUUID(siteId, "site ID");
        UUID spaceUuid = parseUUID(spaceId, "space ID");

        if (!authService.canAccessSite(siteUuid)) {
            return ResponseEntity.status(403).body(Map.of("message", "Access denied to site"));
        }

        try {
            String type = (String) body.get("type");
            String name = (String) body.get("name");
            String parentSpaceId = (String) body.get("parentSpaceId");
            String attributes = body.containsKey("attributes") ? body.get("attributes").toString() : null;

            SpaceDTO updated = spaceService.updateSpace(spaceUuid,
                new SpaceService.UpdateSpaceRequest(type, name, parentSpaceId, attributes));

            return ResponseEntity.ok(Map.of("space", updated));
        } catch (ValidationException e) {
            return ResponseEntity.badRequest().body(Map.of("message", e.getMessage()));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        } catch (Exception e) {
            log.error("Error updating space {}: {}", spaceId, e.getMessage(), e);
            return ResponseEntity.internalServerError().body(Map.of("message", "Failed to update space"));
        }
    }

    /**
     * DELETE /api/v1/sites/{siteId}/spaces/{spaceId}
     * Delete a space (children are re-parented).
     */
    @DeleteMapping("/{spaceId}")
    public ResponseEntity<?> deleteSpace(
            @PathVariable String siteId,
            @PathVariable String spaceId) {

        log.info("DELETE /api/v1/sites/{}/spaces/{}", siteId, spaceId);

        UUID siteUuid = parseUUID(siteId, "site ID");
        UUID spaceUuid = parseUUID(spaceId, "space ID");

        if (!authService.canAccessSite(siteUuid)) {
            return ResponseEntity.status(403).body(Map.of("message", "Access denied to site"));
        }

        try {
            spaceService.deleteSpace(spaceUuid);
            return ResponseEntity.noContent().build();
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.status(404).body(Map.of("message", e.getMessage()));
        } catch (Exception e) {
            log.error("Error deleting space {}: {}", spaceId, e.getMessage(), e);
            return ResponseEntity.internalServerError().body(Map.of("message", "Failed to delete space"));
        }
    }

    private UUID parseUUID(String value, String fieldName) {
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException e) {
            throw new ValidationException("Invalid " + fieldName + " format: " + value);
        }
    }
}
