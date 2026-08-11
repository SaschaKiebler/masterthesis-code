package com.digitaldemon.core.privacy;

import com.digitaldemon.core.common.exception.ResourceNotFoundException;
import com.digitaldemon.core.device.PhysicalDeviceRepository;
import com.digitaldemon.core.metricpoint.MetricPointRepository;
import com.digitaldemon.core.ontology.Link;
import com.digitaldemon.core.ontology.LinkRepository;
import com.digitaldemon.core.ontology.LinkType;
import com.digitaldemon.core.ontology.LinkTypeRepository;
import com.digitaldemon.core.ontology.ObjectEntity;
import com.digitaldemon.core.ontology.ObjectRepository;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * GDPR subject-access and erasure for residents, i.e. {@code PERSON} objects in
 * the ontology graph (thesis QS-SEC-02).
 *
 * <p>What makes consumption data personal is the graph chain
 * {@code PERSON -RESIDES_IN-> space -CONTAINS*-> room <-INSTALLED_IN- asset
 * -REALIZED_BY-> physical device -> measurements.device_id}. Export walks that
 * chain and hands over a copy (Art. 15(3)). Erasure deletes the person object,
 * whose links cascade away in the database — the measurement series stays
 * untouched and thereby loses its subject reference. Retention is justified by
 * the billing-data retention duty (Art. 17(3)(b)) and by the raw-data
 * integrity attribute QS-INT; the residual re-identification risk of a
 * single-resident unit is documented in the thesis, not silently accepted.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PersonPrivacyService {

    public static final String PERSON_TYPE = "PERSON";

    private static final String RESIDES_IN = "RESIDES_IN";
    private static final String CONTAINS = "CONTAINS";
    private static final String INSTALLED_IN = "INSTALLED_IN";
    private static final String REALIZED_BY = "REALIZED_BY";
    private static final String HAS_METRIC = "HAS_METRIC";

    /** Spatial containment is shallow (building, floor, apartment, room). */
    private static final int MAX_CONTAINS_DEPTH = 5;

    private final ObjectRepository objectRepository;
    private final LinkRepository linkRepository;
    private final LinkTypeRepository linkTypeRepository;
    private final PhysicalDeviceRepository physicalDeviceRepository;
    private final MetricPointRepository metricPointRepository;
    private final MeasurementReadStore measurementReadStore;

    /** Local instance — only used to render stored JSONB strings, no Spring config involved. */
    private final ObjectMapper objectMapper = new ObjectMapper();

    // ── Report shapes ─────────────────────────────────────────────────────────

    public record ResidenceEntry(UUID spaceId, String name, String type) {
    }

    public record DeviceEntry(UUID assetId, String assetName, String deviceId) {
    }

    public record SeriesEntry(String deviceId, long count,
                              List<MeasurementReadStore.MeasurementRow> values) {
    }

    public record PersonExport(UUID id, String displayName, UUID tenantId,
                               Map<String, Object> properties,
                               List<ResidenceEntry> residences,
                               List<DeviceEntry> devices,
                               List<SeriesEntry> measurementSeries) {
    }

    public record ErasureReport(UUID personId, int deletedLinks,
                                Map<String, Long> retainedMeasurementsByDevice,
                                String retentionNote) {
    }

    // ── Export ────────────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public PersonExport export(UUID personId) {
        ObjectEntity person = loadPerson(personId);
        List<Link> residences = outbound(personId, RESIDES_IN);
        List<DeviceEntry> devices = reachableDevices(residences);

        List<SeriesEntry> series = devices.stream()
                .map(DeviceEntry::deviceId)
                .distinct()
                .map(deviceId -> new SeriesEntry(
                        deviceId,
                        measurementReadStore.countForDevice(deviceId),
                        measurementReadStore.seriesForDevice(deviceId)))
                .toList();

        return new PersonExport(
                person.getId(),
                person.getDisplayName(),
                person.getTenant() == null ? null : person.getTenant().getId(),
                parseProperties(person.getProperties()),
                residences.stream()
                        .map(l -> new ResidenceEntry(
                                l.getTarget().getId(),
                                l.getTarget().getDisplayName(),
                                l.getTarget().getObjectType().getName()))
                        .toList(),
                devices,
                series);
    }

    // ── Erasure ───────────────────────────────────────────────────────────────

    @Transactional
    public ErasureReport erase(UUID personId) {
        ObjectEntity person = loadPerson(personId);

        // Count what the measurement store keeps, before the graph loses the
        // path to find it — this is the evaluation's evidence that severing,
        // not deleting, happened.
        Map<String, Long> retained = new LinkedHashMap<>();
        for (DeviceEntry device : reachableDevices(outbound(personId, RESIDES_IN))) {
            retained.putIfAbsent(device.deviceId(),
                    measurementReadStore.countForDevice(device.deviceId()));
        }

        int links = linkRepository.findOutboundByObjectId(personId).size()
                + linkRepository.findInboundByObjectId(personId).size();

        // links cascade via ON DELETE CASCADE on the objects FK.
        objectRepository.delete(person);

        log.info("Erased person {} ({} links cascaded, {} device series retained)",
                personId, links, retained.size());

        return new ErasureReport(personId, links, retained,
                "Measurement series are retained unchanged: severing the person link "
                        + "removes the subject reference (Art. 17(3)(b) retention of "
                        + "billing-relevant readings; raw-data integrity per QS-INT).");
    }

    /** Tenant owning this person, for the controller's authorisation check. */
    @Transactional(readOnly = true)
    public UUID tenantOf(UUID personId) {
        ObjectEntity person = loadPerson(personId);
        return person.getTenant() == null ? null : person.getTenant().getId();
    }

    // ── Graph walk ────────────────────────────────────────────────────────────

    /**
     * All devices reachable from the given residences: expand spaces downward
     * via CONTAINS, collect assets installed in them, resolve each asset to its
     * physical device id (via REALIZED_BY) and its metric points' device ids
     * (via HAS_METRIC). Both resolutions are kept because the seed links both
     * and either alone can miss a device family.
     */
    private List<DeviceEntry> reachableDevices(List<Link> residences) {
        Set<UUID> spaceIds = expandSpaces(residences.stream()
                .map(l -> l.getTarget().getId())
                .collect(java.util.stream.Collectors.toCollection(LinkedHashSet::new)));

        List<DeviceEntry> devices = new ArrayList<>();
        Set<String> seenDeviceIds = new LinkedHashSet<>();

        for (UUID spaceId : spaceIds) {
            for (Link installed : inbound(spaceId, INSTALLED_IN)) {
                ObjectEntity asset = installed.getSource();

                for (Link realized : outbound(asset.getId(), REALIZED_BY)) {
                    physicalDeviceRepository.findById(realized.getTarget().getId())
                            .ifPresent(pd -> {
                                if (seenDeviceIds.add(pd.getDeviceId())) {
                                    devices.add(new DeviceEntry(
                                            asset.getId(), asset.getDisplayName(), pd.getDeviceId()));
                                }
                            });
                }
                for (Link hasMetric : outbound(asset.getId(), HAS_METRIC)) {
                    metricPointRepository.findById(hasMetric.getTarget().getId())
                            .ifPresent(mp -> {
                                if (seenDeviceIds.add(mp.getDeviceId())) {
                                    devices.add(new DeviceEntry(
                                            asset.getId(), asset.getDisplayName(), mp.getDeviceId()));
                                }
                            });
                }
            }
        }
        return devices;
    }

    /** Breadth-first expansion over CONTAINS, bounded because the hierarchy is shallow. */
    private Set<UUID> expandSpaces(Set<UUID> roots) {
        Set<UUID> seen = new LinkedHashSet<>(roots);
        Deque<UUID> queue = new ArrayDeque<>(roots);
        int depth = 0;

        while (!queue.isEmpty() && depth < MAX_CONTAINS_DEPTH) {
            int levelSize = queue.size();
            for (int i = 0; i < levelSize; i++) {
                UUID current = queue.poll();
                for (Link contains : outbound(current, CONTAINS)) {
                    UUID child = contains.getTarget().getId();
                    if (seen.add(child)) {
                        queue.add(child);
                    }
                }
            }
            depth++;
        }
        return seen;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private ObjectEntity loadPerson(UUID personId) {
        ObjectEntity person = objectRepository.findById(personId)
                .orElseThrow(() -> new ResourceNotFoundException("Person", personId));
        if (!PERSON_TYPE.equals(person.getObjectType().getName())) {
            throw new ResourceNotFoundException("Person", personId);
        }
        return person;
    }

    private List<Link> outbound(UUID objectId, String linkTypeName) {
        return linkType(linkTypeName)
                .map(t -> linkRepository.findBySourceAndLinkType(objectId, t.getId()))
                .orElse(List.of());
    }

    private List<Link> inbound(UUID objectId, String linkTypeName) {
        return linkType(linkTypeName)
                .map(t -> linkRepository.findByTargetAndLinkType(objectId, t.getId()))
                .orElse(List.of());
    }

    private java.util.Optional<LinkType> linkType(String name) {
        return linkTypeRepository.findByName(name);
    }

    private Map<String, Object> parseProperties(String json) {
        if (json == null || json.isBlank()) {
            return Map.of();
        }
        try {
            return objectMapper.readValue(json,
                    objectMapper.getTypeFactory().constructMapType(Map.class, String.class, Object.class));
        } catch (JsonProcessingException e) {
            // The export must not fail on malformed stored JSON; hand it over raw.
            return Map.of("_raw", json);
        }
    }
}
