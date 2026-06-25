package com.digitaldemon.core.ontology;

import com.digitaldemon.core.ontology.Link;
import com.digitaldemon.core.ontology.LinkType;
import com.digitaldemon.core.ontology.ObjectEntity;
import com.digitaldemon.core.ontology.ObjectType;
import com.digitaldemon.core.tenant.Tenant;
import com.digitaldemon.core.common.exception.ResourceNotFoundException;
import com.digitaldemon.core.common.exception.ServiceException;
import com.digitaldemon.core.ontology.LinkRepository;
import com.digitaldemon.core.ontology.LinkTypeRepository;
import com.digitaldemon.core.ontology.ObjectRepository;
import com.digitaldemon.core.ontology.ObjectTypeRepository;
import com.digitaldemon.core.tenant.TenantRepository;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedList;
import java.util.List;
import java.util.Map;
import java.util.Queue;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.UUID;

/**
 * OntologyService — graph operations for the ADR-011 objects/links layer.
 *
 * All write methods must be called within the same @Transactional context as the
 * typed extension table save (dual-write period). This guarantees atomicity:
 * either both the typed row and the object/link graph are written, or neither.
 *
 * Object types and link types are resolved BY NAME against the database — the DB
 * is the single source of truth for UUIDs. A lazy ConcurrentHashMap cache avoids
 * repeated round-trips for the same seeded types.
 */
@Service
@RequiredArgsConstructor
@Slf4j
@Transactional(readOnly = true)
public class OntologyService {

    // -------------------------------------------------------------------------
    // Object type name constants (string keys, NOT UUIDs — DB owns the IDs)
    // -------------------------------------------------------------------------
    public static final String BUILDING          = "BUILDING";
    public static final String FLOOR             = "FLOOR";
    public static final String APARTMENT         = "APARTMENT";
    public static final String ROOM              = "ROOM";
    public static final String BASEMENT          = "BASEMENT";
    public static final String COMMON_AREA       = "COMMON_AREA";
    public static final String TECHNICAL_ROOM    = "TECHNICAL_ROOM";
    public static final String HEATING_CIRCUIT   = "HEATING_CIRCUIT";
    public static final String HEATING_ZONE      = "HEATING_ZONE";
    public static final String DISTRIBUTION_NET  = "DISTRIBUTION_NETWORK";
    public static final String PERSON            = "PERSON";
    public static final String GENERIC_SENSOR    = "GENERIC_SENSOR";
    public static final String ACTUATOR          = "ACTUATOR";
    public static final String CONTROLLER        = "CONTROLLER";
    public static final String GATEWAY           = "GATEWAY";
    public static final String BOILER            = "BOILER";
    public static final String PUMP              = "PUMP";
    public static final String HEAT_METER        = "HEAT_METER";
    // ADR-013 new object types
    public static final String METRIC_POINT      = "METRIC_POINT";
    public static final String PHYSICAL_QUANTITY = "PHYSICAL_QUANTITY";
    public static final String PHYSICAL_DEVICE   = "PHYSICAL_DEVICE";

    // -------------------------------------------------------------------------
    // Link type name constants (string keys, NOT UUIDs — DB owns the IDs)
    // -------------------------------------------------------------------------
    public static final String CONTAINS          = "CONTAINS";
    public static final String INSTALLED_IN      = "INSTALLED_IN";
    public static final String INSTALLED_AT      = "INSTALLED_AT";
    public static final String FEEDS             = "FEEDS";
    public static final String RETURNS_TO        = "RETURNS_TO";
    public static final String CONTROLS          = "CONTROLS";
    public static final String SENSES            = "SENSES";
    public static final String NETWORK_PARENT    = "NETWORK_PARENT";
    public static final String POWERS            = "POWERS";
    public static final String SERVES            = "SERVES";
    public static final String RESIDES_IN        = "RESIDES_IN";
    public static final String MANAGED_BY        = "MANAGED_BY";
    // ADR-013 new link types
    public static final String MEASURES          = "MEASURES";
    public static final String REALIZED_BY       = "REALIZED_BY";
    public static final String HAS_METRIC        = "HAS_METRIC";
    public static final String DERIVED_FROM      = "DERIVED_FROM";
    public static final String OCCURRED_ON       = "OCCURRED_ON";
    public static final String TRIGGERED_BY      = "TRIGGERED_BY";
    public static final String PRECEDED_BY       = "PRECEDED_BY";

    // -------------------------------------------------------------------------
    // Legacy asset type → ontology type name mapping
    // The assets.type column predates the ontology; this is its translation layer.
    // -------------------------------------------------------------------------
    private static final Map<String, String> ASSET_TYPE_NAMES = Map.of(
        "SENSOR",     GENERIC_SENSOR,
        "ACTUATOR",   ACTUATOR,
        "CONTROLLER", CONTROLLER,
        "GATEWAY",    GATEWAY,
        "HEATER",     BOILER,
        "PUMP",       PUMP
    );

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final ObjectRepository objectRepository;
    private final LinkTypeRepository linkTypeRepository;
    private final LinkRepository linkRepository;
    private final ObjectTypeRepository objectTypeRepository;
    private final TenantRepository tenantRepository;

    // Lazy caches — populated on first use, valid for the lifetime of the application.
    // Object types and link types are seeded system data and do not change at runtime.
    private final ConcurrentHashMap<String, ObjectType> objectTypeCache = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, LinkType>   linkTypeCache   = new ConcurrentHashMap<>();

    // =========================================================================
    // Type name helpers (static — no DB access)
    // =========================================================================

    /**
     * Resolve the ontology type name for a space (spaces.type matches object type name directly).
     */
    public static String spaceTypeName(String spaceType) {
        return spaceType; // FLOOR→FLOOR, APARTMENT→APARTMENT, etc. — no translation needed
    }

    /**
     * Resolve the ontology type name for an asset, translating from the legacy type enum.
     */
    public static String assetTypeName(String assetType) {
        return ASSET_TYPE_NAMES.getOrDefault(assetType, GENERIC_SENSOR);
    }

    // =========================================================================
    // Object registration
    // =========================================================================

    /**
     * Register a new domain entity in the objects table.
     * Must be called within the same @Transactional context as the typed table save.
     *
     * @param id              Same UUID as the typed extension table PK
     * @param objectTypeName  Name of the object type (use String constants defined in this class)
     * @param tenantId        Tenant UUID for access-control scoping (nullable during Phase A)
     * @param displayName     Human-readable name (denormalized from typed table)
     * @return the created ObjectEntity
     */
    @Transactional
    public ObjectEntity registerObject(UUID id, String objectTypeName, UUID tenantId, String displayName) {
        log.debug("Registering object: id={}, type={}, tenant={}", id, objectTypeName, tenantId);

        ObjectType objectType = resolveObjectType(objectTypeName);
        Tenant tenant = tenantId != null ? tenantRepository.getReferenceById(tenantId) : null;

        ObjectEntity object = new ObjectEntity();
        object.setId(id);
        object.setObjectType(objectType);
        object.setTenant(tenant);
        object.setDisplayName(displayName);
        object.setCreatedAt(Instant.now());
        object.setUpdatedAt(Instant.now());

        ObjectEntity saved = objectRepository.save(object);
        log.debug("Registered object: id={}, displayName={}", id, displayName);
        return saved;
    }

    /**
     * Register a new domain entity in the objects table with properties.
     */
    @Transactional
    public ObjectEntity registerObject(UUID id, String objectTypeName, UUID tenantId, String displayName, String properties) {
        log.debug("Registering object: id={}, type={}, tenant={}", id, objectTypeName, tenantId);

        ObjectType objectType = resolveObjectType(objectTypeName);
        Tenant tenant = tenantId != null ? tenantRepository.getReferenceById(tenantId) : null;

        ObjectEntity object = new ObjectEntity();
        object.setId(id);
        object.setObjectType(objectType);
        object.setTenant(tenant);
        object.setDisplayName(displayName);
        object.setProperties(properties != null ? properties : "{}");
        object.setCreatedAt(Instant.now());
        object.setUpdatedAt(Instant.now());

        ObjectEntity saved = objectRepository.save(object);
        log.debug("Registered object: id={}, displayName={}", id, displayName);
        return saved;
    }

    /**
     * Create a new standalone object with properties.
     */
    @Transactional
    public ObjectEntity createObject(String objectTypeName, UUID tenantId, String displayName, String properties) {
        log.info("Creating object: type={}, tenant={}, displayName={}", objectTypeName, tenantId, displayName);

        ObjectType objectType = resolveObjectType(objectTypeName);
        Tenant tenant = tenantRepository.getReferenceById(tenantId);

        ObjectEntity object = new ObjectEntity();
        object.setId(UUID.randomUUID());
        object.setObjectType(objectType);
        object.setTenant(tenant);
        object.setDisplayName(displayName);
        object.setProperties(properties != null ? properties : "{}");
        object.setCreatedAt(Instant.now());
        object.setUpdatedAt(Instant.now());

        ObjectEntity saved = objectRepository.save(object);
        log.info("Created object: id={}, displayName={}, type={}", saved.getId(), displayName, objectTypeName);
        return saved;
    }

    /**
     * Update the properties JSON of an existing object.
     */
    @Transactional
    public void updateProperties(UUID objectId, String properties) {
        log.debug("Updating properties for object: {}", objectId);
        objectRepository.findById(objectId).ifPresent(o -> {
            o.setProperties(properties != null ? properties : "{}");
            o.setUpdatedAt(Instant.now());
            objectRepository.save(o);
        });
    }

    /**
     * Update the display name of an existing object (called when typed entity is renamed).
     */
    @Transactional
    public void updateDisplayName(UUID objectId, String displayName) {
        log.debug("Updating display name for object: {}", objectId);
        objectRepository.findById(objectId).ifPresent(o -> {
            o.setDisplayName(displayName);
            o.setUpdatedAt(Instant.now());
            objectRepository.save(o);
        });
    }

    /**
     * Get an object by ID.
     */
    public ObjectEntity getObject(UUID objectId) {
        return objectRepository.findById(objectId)
            .orElseThrow(() -> new ResourceNotFoundException("Object", objectId));
    }

    /**
     * Create a new standalone object in the objects table.
     * Used by the Ontology Builder IDE to create logical objects (Heating Circuit, Zone, etc.)
     * or any object not tied to an existing typed extension table row.
     * A new UUID is generated automatically.
     *
     * @param objectTypeName  Name of the object type (e.g., HEATING_CIRCUIT)
     * @param tenantId        Tenant UUID for access-control scoping
     * @param displayName     Human-readable name
     * @return the created ObjectEntity
     */
    @Transactional
    public ObjectEntity createObject(String objectTypeName, UUID tenantId, String displayName) {
        log.info("Creating object: type={}, tenant={}, displayName={}", objectTypeName, tenantId, displayName);

        ObjectType objectType = resolveObjectType(objectTypeName);
        Tenant tenant = tenantRepository.getReferenceById(tenantId);

        ObjectEntity object = new ObjectEntity();
        object.setId(UUID.randomUUID());
        object.setObjectType(objectType);
        object.setTenant(tenant);
        object.setDisplayName(displayName);
        object.setCreatedAt(Instant.now());
        object.setUpdatedAt(Instant.now());

        ObjectEntity saved = objectRepository.save(object);
        log.info("Created object: id={}, displayName={}, type={}", saved.getId(), displayName, objectTypeName);
        return saved;
    }

    /**
     * Delete an object and all its links (cascaded by FK constraint).
     *
     * @param objectId UUID of the object to delete
     */
    @Transactional
    public void deleteObject(UUID objectId) {
        log.info("Deleting object: {}", objectId);
        if (!objectRepository.existsById(objectId)) {
            throw new ResourceNotFoundException("Object", objectId);
        }
        objectRepository.deleteById(objectId);
        log.info("Deleted object: {}", objectId);
    }

    // =========================================================================
    // Link operations
    // =========================================================================

    /**
     * Create a link between two objects. Idempotent — does nothing if the link already exists.
     * The uq_link constraint (source, target, type) guarantees uniqueness at the DB level.
     *
     * @param sourceId       UUID of the source object (must exist in objects table)
     * @param targetId       UUID of the target object (must exist in objects table)
     * @param linkTypeName   Name of the link type (use String constants defined in this class)
     */
    @Transactional
    public void upsertLink(UUID sourceId, UUID targetId, String linkTypeName) {
        LinkType linkType = resolveLinkType(linkTypeName);
        UUID linkTypeId = linkType.getId();

        if (linkRepository.existsBySourceTargetAndType(sourceId, targetId, linkTypeId)) {
            log.debug("Link already exists: {}→{} (type={}), skipping", sourceId, targetId, linkTypeName);
            return;
        }

        log.debug("Creating link: {}→{} (type={})", sourceId, targetId, linkTypeName);

        ObjectEntity source = objectRepository.getReferenceById(sourceId);
        ObjectEntity target = objectRepository.getReferenceById(targetId);

        Link link = new Link();
        link.setLinkType(linkType);
        link.setSource(source);
        link.setTarget(target);
        link.setProperties("{}");
        link.setCreatedAt(Instant.now());

        linkRepository.save(link);
        log.debug("Created link: {}→{} (type={})", sourceId, targetId, linkTypeName);
    }

    /**
     * Delete all outbound links of a given type from a source object.
     * Used before creating a replacement link (e.g. relocating an asset).
     */
    @Transactional
    public void deleteOutboundLinksOfType(UUID sourceId, String linkTypeName) {
        UUID linkTypeId = resolveLinkType(linkTypeName).getId();
        log.debug("Deleting outbound links from {} (type={})", sourceId, linkTypeName);
        linkRepository.deleteBySourceAndLinkType(sourceId, linkTypeId);
    }

    /**
     * Delete all inbound links of a given type pointing to a target object.
     * Used before re-parenting a space (replacing its CONTAINS source).
     */
    @Transactional
    public void deleteInboundLinksOfType(UUID targetId, String linkTypeName) {
        UUID linkTypeId = resolveLinkType(linkTypeName).getId();
        log.debug("Deleting inbound links to {} (type={})", targetId, linkTypeName);
        linkRepository.deleteByTargetAndLinkType(targetId, linkTypeId);
    }

    /**
     * Replace the CONTAINS parent of an object.
     * Atomically removes all existing CONTAINS inbound links and creates a new one.
     *
     * @param objectId    The contained object whose parent is changing
     * @param newSourceId The new containing object (building or parent space)
     */
    @Transactional
    public void replaceContainsParent(UUID objectId, UUID newSourceId) {
        log.debug("Replacing CONTAINS parent of {} → {}", objectId, newSourceId);
        deleteInboundLinksOfType(objectId, CONTAINS);
        upsertLink(newSourceId, objectId, CONTAINS);
    }

    // =========================================================================
    // Graph read operations
    // =========================================================================

    /**
     * Get all objects directly reachable from source via the given link type.
     */
    public List<ObjectEntity> getOutboundNeighbors(UUID sourceId, String linkTypeName) {
        UUID linkTypeId = resolveLinkType(linkTypeName).getId();
        return linkRepository.findBySourceAndLinkType(sourceId, linkTypeId)
                .stream()
                .map(Link::getTarget)
                .toList();
    }

    /**
     * Get all objects that link to target via the given link type.
     */
    public List<ObjectEntity> getInboundNeighbors(UUID targetId, String linkTypeName) {
        UUID linkTypeId = resolveLinkType(linkTypeName).getId();
        return linkRepository.findByTargetAndLinkType(targetId, linkTypeId)
                .stream()
                .map(Link::getSource)
                .toList();
    }

    /**
     * BFS: collect all objects transitively reachable from {@code startId}.
     *
     * <p>When {@code linkTypeName} is {@code null}, blank, or {@code "ANY"}, the traversal
     * follows ALL link types in both directions, excluding HAS_METRIC links (which lead to
     * MetricPoint objects rather than domain peers). Otherwise only the specified link type
     * and direction are followed at each hop.</p>
     *
     * <p>The start object is NOT included in the result. Cycles are handled via a visited set.</p>
     *
     * @param startId      UUID of the anchor object to start from
     * @param linkTypeName Link type to follow, or null/"ANY" for all domain link types
     * @param direction    "OUTBOUND" or "INBOUND" (ignored when isAny)
     * @return all transitively reachable domain objects (may be empty)
     */
    public List<ObjectEntity> getReachableObjects(UUID startId, String linkTypeName, String direction) {
        boolean isAny = linkTypeName == null || linkTypeName.isBlank()
                || "ANY".equalsIgnoreCase(linkTypeName);

        Set<UUID> visited = new HashSet<>();
        Queue<UUID> queue = new LinkedList<>();
        List<ObjectEntity> result = new ArrayList<>();

        visited.add(startId);
        queue.add(startId);

        while (!queue.isEmpty()) {
            UUID current = queue.poll();
            List<ObjectEntity> neighbors = new ArrayList<>();

            if (isAny) {
                for (Link l : linkRepository.findOutboundByObjectId(current)) {
                    if (!HAS_METRIC.equals(l.getLinkType().getName())) {
                        neighbors.add(l.getTarget());
                    }
                }
                for (Link l : linkRepository.findInboundByObjectId(current)) {
                    if (!HAS_METRIC.equals(l.getLinkType().getName())) {
                        neighbors.add(l.getSource());
                    }
                }
            } else if ("INBOUND".equals(direction)) {
                neighbors = getInboundNeighbors(current, linkTypeName);
            } else {
                neighbors = getOutboundNeighbors(current, linkTypeName);
            }

            for (ObjectEntity neighbor : neighbors) {
                if (neighbor != null && visited.add(neighbor.getId())) {
                    result.add(neighbor);
                    queue.add(neighbor.getId());
                }
            }
        }
        return result;
    }

    /**
     * Fetch all inbound and outbound links for a given object.
     * Used by the graph API to power the link management UI.
     */
    public ObjectLinksResult getLinksForObject(UUID objectId) {
        return new ObjectLinksResult(
                linkRepository.findOutboundByObjectId(objectId),
                linkRepository.findInboundByObjectId(objectId)
        );
    }

    /**
     * Create a link between two objects, returning the persisted Link entity.
     * Unlike {@link #upsertLink}, this method returns the entity so the API can serialise it.
     * If the link already exists it returns the existing one without creating a duplicate.
     *
     * @param sourceId     UUID of the source object
     * @param targetId     UUID of the target object
     * @param linkTypeName Name of the link type (use String constants defined in this class)
     */
    @Transactional
    public Link createLink(UUID sourceId, UUID targetId, String linkTypeName) {
        LinkType linkType = resolveLinkType(linkTypeName);
        UUID linkTypeId = linkType.getId();

        return linkRepository.findBySourceTargetAndType(sourceId, targetId, linkTypeId)
                .orElseGet(() -> {
                    log.debug("Creating link (createLink): {}→{} (type={})", sourceId, targetId, linkTypeName);
                    ObjectEntity source = objectRepository.getReferenceById(sourceId);
                    ObjectEntity target = objectRepository.getReferenceById(targetId);

                    Link link = new Link();
                    link.setLinkType(linkType);
                    link.setSource(source);
                    link.setTarget(target);
                    link.setProperties("{}");
                    link.setCreatedAt(Instant.now());
                    linkRepository.save(link);

                    // Refetch with full JOIN FETCHes so callers can serialise both sides
                    // without hitting LazyInitializationException after the session closes.
                    return linkRepository.findBySourceTargetAndType(sourceId, targetId, linkTypeId)
                            .orElseThrow(() -> new ServiceException("Failed to reload link after save"));
                });
    }

    /**
     * Delete a link by its ID.
     * Throws {@link ResourceNotFoundException} if the link does not exist.
     */
    @Transactional
    public void deleteLink(UUID linkId) {
        if (!linkRepository.existsById(linkId)) {
            throw new ResourceNotFoundException("Link", linkId);
        }
        linkRepository.deleteById(linkId);
        log.debug("Deleted link: {}", linkId);
    }

    /**
     * Create a new link type and immediately populate the cache.
     * Called by GraphController when the user defines a type on the fly.
     * Caller is responsible for checking duplicate names before calling this.
     *
     * @param name        Machine key — must be UPPER_SNAKE_CASE, unique
     * @param displayName Human-readable label shown in the UI
     * @param description Optional documentation
     * @param inverseName Optional inverse relation name (e.g. CONTAINS → CONTAINED_BY)
     */
    @Transactional
    public LinkType createLinkType(String name, String displayName, String description, String inverseName) {
        log.debug("Creating link type: {}", name);

        LinkType lt = new LinkType();
        lt.setName(name);
        lt.setDisplayName(displayName);
        lt.setDescription(description);
        lt.setInverseName(inverseName);
        lt.setCreatedAt(Instant.now());

        LinkType saved = linkTypeRepository.save(lt);

        // Warm the cache immediately so upsertLink/createLink work without a round-trip
        linkTypeCache.put(name, saved);

        log.info("Created link type: {} (id: {})", name, saved.getId());
        return saved;
    }

    // =========================================================================
    // Phase D: Link-based relationship resolvers (replace FK column reads)
    // =========================================================================

    /**
     * Resolve the single target of a link from a source object.
     * E.g. asset → INSTALLED_AT → building returns the building UUID.
     *
     * @return the target UUID, or null if no such link exists
     */
    public UUID resolveTargetId(UUID sourceId, String linkTypeName) {
        UUID linkTypeId = resolveLinkType(linkTypeName).getId();
        return linkRepository.findTargetId(sourceId, linkTypeId).orElse(null);
    }

    /**
     * Resolve the single source of a link pointing at a target.
     * E.g. space ← CONTAINS ← parent returns the parent UUID.
     * Returns the first source if multiple exist, or null if none.
     */
    public UUID resolveSourceId(UUID targetId, String linkTypeName) {
        UUID linkTypeId = resolveLinkType(linkTypeName).getId();
        List<UUID> sources = linkRepository.findSourceIds(targetId, linkTypeId);
        return sources.isEmpty() ? null : sources.get(0);
    }

    /**
     * Count objects linking to a target via a given type.
     * Replaces FK-based countBySiteId / countBySpaceId.
     */
    public int countByTargetAndType(UUID targetId, String linkTypeName) {
        UUID linkTypeId = resolveLinkType(linkTypeName).getId();
        return linkRepository.countByTargetAndLinkType(targetId, linkTypeId);
    }

    /**
     * Find all source object IDs linking to a target via a given type.
     * E.g. all asset IDs INSTALLED_AT a building.
     */
    public List<UUID> findSourceIds(UUID targetId, String linkTypeName) {
        UUID linkTypeId = resolveLinkType(linkTypeName).getId();
        return linkRepository.findSourceIdsByTargetAndType(targetId, linkTypeId);
    }

    // =========================================================================
    // Result type for getLinksForObject
    // =========================================================================

    public record ObjectLinksResult(List<Link> outbound, List<Link> inbound) {}

    // =========================================================================
    // Private: type resolution with lazy cache
    // =========================================================================

    /**
     * Resolve an object type by its name, using the cache to avoid repeated DB queries.
     * System types (tenant_id IS NULL) are the only valid target here.
     */
    private ObjectType resolveObjectType(String name) {
        return objectTypeCache.computeIfAbsent(name, n ->
                objectTypeRepository.findSystemTypeByName(n)
                        .orElseThrow(() -> new ServiceException("Unknown object type: " + n)));
    }

    /**
     * Resolve a link type by its name, using the cache to avoid repeated DB queries.
     */
    private LinkType resolveLinkType(String name) {
        return linkTypeCache.computeIfAbsent(name, n ->
                linkTypeRepository.findByName(n)
                        .orElseThrow(() -> new ServiceException("Unknown link type: " + n)));
    }

    // =========================================================================
    // Static property helpers
    // =========================================================================

    /**
     * Extract a top-level field from a properties JSON string.
     * Returns the value as a JSON string (for objects/arrays) or plain string (for scalars).
     * Returns null if the key is absent or properties is empty.
     */
    @SuppressWarnings("unchecked")
    public static String extractProperty(String propertiesJson, String key) {
        if (propertiesJson == null || propertiesJson.equals("{}") || propertiesJson.isBlank()) return null;
        try {
            Map<String, Object> props = MAPPER.readValue(propertiesJson, Map.class);
            Object value = props.get(key);
            if (value == null) return null;
            if (value instanceof String s) return s;
            return MAPPER.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            return null;
        }
    }

    /**
     * Build a properties JSON string with a single key-value pair.
     * The value is embedded as-is (must be valid JSON or a string).
     */
    public static String buildProperties(String key, String valueJson) {
        if (valueJson == null || valueJson.isBlank()) return "{}";
        try {
            // Parse value to ensure it's valid JSON, then embed under key
            Object parsed = MAPPER.readValue(valueJson, Object.class);
            Map<String, Object> props = Map.of(key, parsed);
            return MAPPER.writeValueAsString(props);
        } catch (JsonProcessingException e) {
            // If not valid JSON, treat as plain string
            try {
                return MAPPER.writeValueAsString(Map.of(key, valueJson));
            } catch (JsonProcessingException ex) {
                return "{}";
            }
        }
    }

    /**
     * Merge a key-value pair into existing properties JSON.
     */
    @SuppressWarnings("unchecked")
    public static String mergeProperty(String propertiesJson, String key, String valueJson) {
        Map<String, Object> props;
        try {
            props = (propertiesJson != null && !propertiesJson.isBlank())
                ? new java.util.HashMap<>(MAPPER.readValue(propertiesJson, Map.class))
                : new java.util.HashMap<>();
        } catch (JsonProcessingException e) {
            props = new java.util.HashMap<>();
        }
        try {
            if (valueJson != null) {
                props.put(key, MAPPER.readValue(valueJson, Object.class));
            } else {
                props.remove(key);
            }
            return MAPPER.writeValueAsString(props);
        } catch (JsonProcessingException e) {
            return propertiesJson != null ? propertiesJson : "{}";
        }
    }
}
