package com.digitaldemon.core.space;

import com.digitaldemon.core.ontology.OntologyService;

import com.digitaldemon.core.space.SpaceDTO;
import com.digitaldemon.core.ontology.ObjectEntity;
import com.digitaldemon.core.common.exception.ResourceNotFoundException;
import com.digitaldemon.core.common.exception.ServiceException;
import com.digitaldemon.core.common.exception.ValidationException;
import com.digitaldemon.core.ontology.ObjectRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;

@Service
@RequiredArgsConstructor
@Slf4j
@Transactional(readOnly = true)
public class SpaceService {

    private static final Set<String> VALID_TYPES = Set.of(
        "FLOOR", "APARTMENT", "ROOM", "BASEMENT", "COMMON_AREA", "TECHNICAL_ROOM"
    );

    private final ObjectRepository objectRepository;
    private final OntologyService ontologyService;

    /**
     * Get all spaces for a site as a flat list.
     */
    public List<SpaceDTO> getSpacesBySite(UUID siteId) {
        log.debug("Fetching spaces for site: {}", siteId);
        List<UUID> spaceIds = collectContainedSpaceIds(siteId);
        if (spaceIds.isEmpty()) return List.of();
        return objectRepository.findAllWithTypeByIdIn(spaceIds).stream()
            .sorted(Comparator.comparing(o -> o.getDisplayName() != null ? o.getDisplayName() : ""))
            .map(this::toFlatDTO)
            .toList();
    }

    /**
     * Get all spaces for a site as a hierarchical tree.
     */
    public List<SpaceDTO> getSpaceTree(UUID siteId) {
        log.debug("Building space tree for site: {}", siteId);

        List<UUID> spaceIds = collectContainedSpaceIds(siteId);
        if (spaceIds.isEmpty()) return List.of();

        List<ObjectEntity> allSpaces = objectRepository.findAllWithTypeByIdIn(spaceIds);
        allSpaces.sort(Comparator.comparing(o -> o.getDisplayName() != null ? o.getDisplayName() : ""));

        Map<UUID, UUID> parentMap = new HashMap<>();
        for (ObjectEntity s : allSpaces) {
            UUID parentId = ontologyService.resolveSourceId(s.getId(), OntologyService.CONTAINS);
            if (parentId != null) parentMap.put(s.getId(), parentId);
        }

        Map<UUID, List<ObjectEntity>> childrenByParent = new HashMap<>();
        for (ObjectEntity s : allSpaces) {
            UUID parentId = parentMap.get(s.getId());
            if (parentId != null && spaceIds.contains(parentId)) {
                childrenByParent.computeIfAbsent(parentId, k -> new ArrayList<>()).add(s);
            }
        }

        Set<UUID> spaceIdSet = new HashSet<>(spaceIds);
        return allSpaces.stream()
            .filter(s -> {
                UUID p = parentMap.get(s.getId());
                return p == null || !spaceIdSet.contains(p);
            })
            .map(root -> buildTreeNode(root, childrenByParent, parentMap, siteId))
            .toList();
    }

    /**
     * Get a single space by ID.
     */
    public Optional<SpaceDTO> getSpaceById(UUID id) {
        log.debug("Fetching space: {}", id);
        return objectRepository.findById(id).map(this::toFlatDTO);
    }

    /**
     * Create a new space within a site.
     */
    @Transactional
    public SpaceDTO createSpace(UUID siteId, CreateSpaceRequest request) {
        log.info("Creating space '{}' of type {} in site: {}", request.name(), request.type(), siteId);

        validateType(request.type());
        validateName(request.name());

        ObjectEntity site = objectRepository.findById(siteId)
            .orElseThrow(() -> new ResourceNotFoundException("Site", siteId));

        if (request.parentSpaceId() != null) {
            if (!objectRepository.existsById(request.parentSpaceId())) {
                throw new ResourceNotFoundException("Parent space", request.parentSpaceId());
            }
            UUID parentSiteId = resolveSpaceSiteId(request.parentSpaceId());
            if (parentSiteId != null && !parentSiteId.equals(siteId)) {
                throw new ValidationException("Parent space does not belong to the same site");
            }
        }

        try {
            String properties = "{}";
            if (request.attributes() != null && !request.attributes().isBlank()) {
                properties = OntologyService.mergeProperty("{}", "attributes", request.attributes());
            }

            String objectTypeName = OntologyService.spaceTypeName(request.type());
            UUID tenantId = site.getTenant() != null ? site.getTenant().getId() : null;
            UUID spaceId = UUID.randomUUID();
            ObjectEntity saved = ontologyService.registerObject(spaceId, objectTypeName, tenantId, request.name().trim(), properties);

            UUID containsSourceId = request.parentSpaceId() != null ? request.parentSpaceId() : siteId;
            ontologyService.upsertLink(containsSourceId, saved.getId(), OntologyService.CONTAINS);

            log.info("Created space: {} (id: {}) in site: {}", saved.getDisplayName(), saved.getId(), siteId);
            return toFlatDTO(saved);
        } catch (DataAccessException e) {
            log.error("Database error creating space in site {}: {}", siteId, e.getMessage(), e);
            throw new ServiceException("Failed to create space", e);
        }
    }

    /**
     * Update an existing space.
     */
    @Transactional
    public SpaceDTO updateSpace(UUID spaceId, UpdateSpaceRequest request) {
        log.info("Updating space: {}", spaceId);

        ObjectEntity space = objectRepository.findById(spaceId)
            .orElseThrow(() -> new ResourceNotFoundException("Space", spaceId));

        if (request.name() != null) {
            validateName(request.name());
            space.setDisplayName(request.name().trim());
        }
        if (request.attributes() != null) {
            String props = OntologyService.mergeProperty(space.getProperties(), "attributes", request.attributes());
            space.setProperties(props);
        }

        UUID spaceSiteId = resolveSpaceSiteId(spaceId);

        if (request.parentSpaceId() != null) {
            if (request.parentSpaceId().isBlank()) {
                if (spaceSiteId != null) {
                    ontologyService.replaceContainsParent(spaceId, spaceSiteId);
                }
            } else {
                UUID parentId = UUID.fromString(request.parentSpaceId());
                if (parentId.equals(spaceId)) {
                    throw new ValidationException("A space cannot be its own parent");
                }
                if (!objectRepository.existsById(parentId)) {
                    throw new ResourceNotFoundException("Parent space", parentId);
                }
                UUID parentSiteId = resolveSpaceSiteId(parentId);
                if (spaceSiteId != null && parentSiteId != null && !spaceSiteId.equals(parentSiteId)) {
                    throw new ValidationException("Parent space does not belong to the same site");
                }
                ontologyService.replaceContainsParent(spaceId, parentId);
            }
        }

        try {
            space.setUpdatedAt(java.time.Instant.now());
            ObjectEntity saved = objectRepository.save(space);

            if (request.name() != null) {
                ontologyService.updateDisplayName(saved.getId(), saved.getDisplayName());
            }

            log.info("Updated space: {} (id: {})", saved.getDisplayName(), saved.getId());
            return toFlatDTO(saved);
        } catch (DataAccessException e) {
            log.error("Database error updating space {}: {}", spaceId, e.getMessage(), e);
            throw new ServiceException("Failed to update space", e);
        }
    }

    /**
     * Delete a space. Children are re-parented to the deleted space's parent.
     */
    @Transactional
    public void deleteSpace(UUID spaceId) {
        log.info("Deleting space: {}", spaceId);

        if (!objectRepository.existsById(spaceId)) {
            throw new ResourceNotFoundException("Space", spaceId);
        }

        UUID parentId = ontologyService.resolveSourceId(spaceId, OntologyService.CONTAINS);
        List<ObjectEntity> children = ontologyService.getOutboundNeighbors(spaceId, OntologyService.CONTAINS);
        for (ObjectEntity child : children) {
            if (parentId != null) {
                ontologyService.replaceContainsParent(child.getId(), parentId);
            } else {
                ontologyService.deleteInboundLinksOfType(child.getId(), OntologyService.CONTAINS);
            }
        }

        try {
            ontologyService.deleteObject(spaceId);
            log.info("Deleted space: {}, re-parented {} children", spaceId, children.size());
        } catch (DataAccessException e) {
            log.error("Database error deleting space {}: {}", spaceId, e.getMessage(), e);
            throw new ServiceException("Failed to delete space", e);
        }
    }

    // --- Request DTOs ---

    public record CreateSpaceRequest(
        String type,
        String name,
        UUID parentSpaceId,
        String attributes
    ) {}

    public record UpdateSpaceRequest(
        String type,
        String name,
        String parentSpaceId,
        String attributes
    ) {}

    // --- Private helpers ---

    private void validateType(String type) {
        if (type == null || type.isBlank()) {
            throw new ValidationException("Space type must not be empty");
        }
        if (!VALID_TYPES.contains(type)) {
            throw new ValidationException("Invalid space type: " + type + ". Valid types: " + VALID_TYPES);
        }
    }

    private void validateName(String name) {
        if (name == null || name.isBlank()) {
            throw new ValidationException("Space name must not be empty");
        }
        if (name.trim().length() < 2) {
            throw new ValidationException("Space name must be at least 2 characters");
        }
    }

    private UUID resolveSpaceSiteId(UUID spaceId) {
        UUID current = spaceId;
        for (int depth = 0; depth < 10; depth++) {
            UUID parent = ontologyService.resolveSourceId(current, OntologyService.CONTAINS);
            if (parent == null) return null;
            var parentObj = ontologyService.getObject(parent);
            if (OntologyService.BUILDING.equals(parentObj.getObjectType().getName())) {
                return parent;
            }
            current = parent;
        }
        return null;
    }

    private List<UUID> collectContainedSpaceIds(UUID rootId) {
        List<UUID> result = new ArrayList<>();
        List<ObjectEntity> direct = ontologyService.getOutboundNeighbors(rootId, OntologyService.CONTAINS);
        for (ObjectEntity child : direct) {
            result.add(child.getId());
            result.addAll(collectContainedSpaceIds(child.getId()));
        }
        return result;
    }

    private SpaceDTO toFlatDTO(ObjectEntity obj) {
        UUID siteId = resolveSpaceSiteId(obj.getId());
        UUID parentSpaceId = ontologyService.resolveSourceId(obj.getId(), OntologyService.CONTAINS);
        if (parentSpaceId != null && siteId != null && parentSpaceId.equals(siteId)) {
            parentSpaceId = null;
        }
        String attributes = OntologyService.extractProperty(obj.getProperties(), "attributes");
        return new SpaceDTO(
            obj.getId(),
            siteId,
            parentSpaceId,
            obj.getObjectType().getName(),
            obj.getDisplayName(),
            attributes != null ? attributes : "{}",
            List.of()
        );
    }

    private SpaceDTO buildTreeNode(ObjectEntity space, Map<UUID, List<ObjectEntity>> childrenByParent,
                                   Map<UUID, UUID> parentMap, UUID siteId) {
        List<SpaceDTO> children = childrenByParent.getOrDefault(space.getId(), List.of())
            .stream()
            .map(child -> buildTreeNode(child, childrenByParent, parentMap, siteId))
            .toList();

        UUID parentId = parentMap.get(space.getId());
        if (parentId != null && parentId.equals(siteId)) {
            parentId = null;
        }

        String attributes = OntologyService.extractProperty(space.getProperties(), "attributes");

        return new SpaceDTO(
            space.getId(),
            siteId,
            parentId,
            space.getObjectType().getName(),
            space.getDisplayName(),
            attributes != null ? attributes : "{}",
            children
        );
    }
}
