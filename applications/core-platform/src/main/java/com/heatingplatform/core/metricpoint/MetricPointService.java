package com.heatingplatform.core.metricpoint;

import com.heatingplatform.core.ontology.OntologyService;
import com.heatingplatform.core.physicalquantity.PhysicalQuantityService;

import com.heatingplatform.core.metricpoint.MetricPoint;
import com.heatingplatform.core.physicalquantity.PhysicalQuantity;
import com.heatingplatform.core.common.exception.ResourceNotFoundException;
import com.heatingplatform.core.metricpoint.MetricPointRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Slf4j
@Transactional(readOnly = true)
public class MetricPointService {

    private final MetricPointRepository metricPointRepository;
    private final PhysicalQuantityService physicalQuantityService;
    private final OntologyService ontologyService;

    /**
     * List all metric points for an asset, traversing the HAS_METRIC link in the ontology graph.
     */
    public List<MetricPoint> getForAsset(UUID assetId, UUID tenantId) {
        return metricPointRepository.findByAssetIdViaHasMetric(assetId, tenantId);
    }

    public Optional<MetricPoint> findById(UUID id) {
        return metricPointRepository.findById(id);
    }

    public Optional<MetricPoint> findByDeviceIdAndMetricId(String deviceId, short metricId) {
        return metricPointRepository.findByDeviceIdAndMetricId(deviceId, metricId);
    }

    /**
     * Create a metric point and link it to an asset via HAS_METRIC.
     * Also creates MEASURES link to the physical quantity if provided.
     */
    @Transactional
    public MetricPoint createMetricPoint(UUID assetId, String deviceId, short metricId,
                                          String quantityName, String unit, String source,
                                          String field, Double minValue, Double maxValue,
                                          Integer sampleIntervalSeconds, UUID tenantId) {
        UUID id = UUID.randomUUID();

        // Resolve physical quantity.
        // Keep the original signal map entry name (e.g. "phase_a_active_power") as the
        // display_name so that phases are distinguishable in the UI. The physical quantity
        // link provides the semantic connection for cross-asset queries.
        UUID quantityId = null;
        String displayName = quantityName != null ? quantityName : "Metric " + metricId;
        if (quantityName != null) {
            Optional<PhysicalQuantity> pq = physicalQuantityService.resolveByName(quantityName);
            if (pq.isPresent()) {
                quantityId = pq.get().getId();
                // Do NOT overwrite displayName with PQ display name + deviceId — that would
                // make phase_a/b/c variants indistinguishable (same PQ, same device).
            }
        }

        ontologyService.registerObject(id, OntologyService.METRIC_POINT, tenantId, displayName);

        MetricPoint mp = new MetricPoint();
        mp.setId(id);
        mp.setDeviceId(deviceId);
        mp.setMetricId(metricId);
        mp.setSource(source);
        mp.setField(field);
        mp.setQuantityId(quantityId);
        mp.setUnit(unit != null ? unit : "");
        mp.setMinValue(minValue);
        mp.setMaxValue(maxValue);
        mp.setSampleIntervalSeconds(sampleIntervalSeconds);
        mp.setCreatedAt(Instant.now());
        mp.setUpdatedAt(Instant.now());

        MetricPoint saved = metricPointRepository.save(mp);

        // Create graph links
        ontologyService.upsertLink(assetId, id, OntologyService.HAS_METRIC);
        if (quantityId != null) {
            ontologyService.upsertLink(id, quantityId, OntologyService.MEASURES);
        }

        log.info("Created metric point: {} ({}) for asset: {}", displayName, id, assetId);
        return saved;
    }

    /**
     * Upsert from a signal_map entry. If a MetricPoint with the same (device_id, metric_id)
     * already exists (possibly owned by a different asset), update its fields and reassign
     * the HAS_METRIC link to the given assetId. This avoids the UNIQUE constraint violation
     * when a physical device ID is reused for a new logical object.
     *
     * signal_map entry format: { "name": "phase_a_active_power", "unit": "W", "source": "em:0", "field": "a_act_power" }
     */
    @Transactional
    public MetricPoint createFromSignalMapEntry(UUID assetId, String deviceId, int metricId,
                                                 Map<String, Object> signalEntry, UUID tenantId) {
        String name = (String) signalEntry.getOrDefault("name", "metric_" + metricId);
        String unit = (String) signalEntry.getOrDefault("unit", "");
        String source = (String) signalEntry.get("source");
        String field = (String) signalEntry.get("field");
        Double min = signalEntry.get("min") instanceof Number n ? n.doubleValue() : null;
        Double max = signalEntry.get("max") instanceof Number n ? n.doubleValue() : null;

        // If a metric point with same (device_id, metric_id) already exists (e.g. from a previous
        // object that shared the same hardware ID), reassign its HAS_METRIC link rather than
        // trying to INSERT a duplicate — which would fail the UNIQUE (device_id, metric_id) constraint.
        Optional<MetricPoint> existing = metricPointRepository.findByDeviceIdAndMetricId(deviceId, (short) metricId);
        if (existing.isPresent()) {
            MetricPoint mp = existing.get();
            mp.setUnit(unit);
            if (source != null) mp.setSource(source);
            if (field  != null) mp.setField(field);
            if (min    != null) mp.setMinValue(min);
            if (max    != null) mp.setMaxValue(max);
            mp.setUpdatedAt(java.time.Instant.now());
            metricPointRepository.save(mp);
            ontologyService.updateDisplayName(mp.getId(), name);
            // Re-home HAS_METRIC: remove link from previous owner, add to current asset.
            ontologyService.deleteInboundLinksOfType(mp.getId(), OntologyService.HAS_METRIC);
            ontologyService.upsertLink(assetId, mp.getId(), OntologyService.HAS_METRIC);
            log.info("Reassigned metric point {} ({}) to asset {}", mp.getId(), name, assetId);
            return mp;
        }

        return createMetricPoint(assetId, deviceId, (short) metricId, name, unit,
            source, field, min, max, null, tenantId);
    }

    @Transactional
    public MetricPoint updateMetricPoint(UUID id, String unit, Double minValue, Double maxValue,
                                          Integer sampleIntervalSeconds, String quantityName,
                                          UUID tenantId) {
        MetricPoint mp = metricPointRepository.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException("MetricPoint", id));

        if (unit != null) mp.setUnit(unit);
        if (minValue != null) mp.setMinValue(minValue);
        if (maxValue != null) mp.setMaxValue(maxValue);
        if (sampleIntervalSeconds != null) mp.setSampleIntervalSeconds(sampleIntervalSeconds);

        if (quantityName != null) {
            physicalQuantityService.resolveByName(quantityName).ifPresent(pq -> {
                UUID oldQuantityId = mp.getQuantityId();
                mp.setQuantityId(pq.getId());
                // Update MEASURES link
                if (oldQuantityId != null) {
                    ontologyService.deleteOutboundLinksOfType(id, OntologyService.MEASURES);
                }
                ontologyService.upsertLink(id, pq.getId(), OntologyService.MEASURES);
            });
        }

        mp.setUpdatedAt(Instant.now());
        return metricPointRepository.save(mp);
    }

    @Transactional
    public void deleteMetricPoint(UUID id) {
        if (!metricPointRepository.existsById(id)) {
            throw new ResourceNotFoundException("MetricPoint", id);
        }
        metricPointRepository.deleteById(id);
        log.info("Deleted metric point: {}", id);
    }

    /**
     * Diff-based reconciliation of signal map entries against existing metric points.
     * <ul>
     *   <li>metric_id in both old &amp; new → update in-place (UUID preserved)</li>
     *   <li>metric_id only in new → create new metric point</li>
     *   <li>metric_id only in old → delete that metric point</li>
     * </ul>
     * Order: delete → update → create (avoids UNIQUE(device_id, metric_id) constraint violations).
     */
    @Transactional
    @SuppressWarnings("unchecked")
    public void reconcileSignalMap(UUID assetId, String deviceId,
                                    Map<String, Object> newSignalMap, UUID tenantId) {
        List<MetricPoint> existing = metricPointRepository.findByAssetIdViaHasMetric(assetId, tenantId);
        Map<Short, MetricPoint> existingByMetricId = new LinkedHashMap<>();
        for (MetricPoint mp : existing) {
            existingByMetricId.put(mp.getMetricId(), mp);
        }

        Set<Short> newMetricIds = new LinkedHashSet<>();
        for (String key : newSignalMap.keySet()) {
            try {
                newMetricIds.add(Short.parseShort(key));
            } catch (NumberFormatException e) {
                log.warn("Skipping signal map entry with non-numeric key: {}", key);
            }
        }

        // 1) Delete: metric_id only in old
        Set<Short> toDelete = new LinkedHashSet<>(existingByMetricId.keySet());
        toDelete.removeAll(newMetricIds);
        for (short metricId : toDelete) {
            MetricPoint mp = existingByMetricId.get(metricId);
            deleteMetricPointFully(mp);
        }
        log.info("Reconcile signal map for asset {}: deleted {} metric points", assetId, toDelete.size());

        // 2) Update: metric_id in both old & new
        int updated = 0;
        for (short metricId : newMetricIds) {
            if (existingByMetricId.containsKey(metricId)) {
                MetricPoint mp = existingByMetricId.get(metricId);
                Map<String, Object> signalEntry = (Map<String, Object>) newSignalMap.get(String.valueOf(metricId));
                updateMetricPointFromSignalEntry(mp, signalEntry, deviceId);
                updated++;
            }
        }
        log.info("Reconcile signal map for asset {}: updated {} metric points", assetId, updated);

        // 3) Create: metric_id only in new
        int created = 0;
        for (short metricId : newMetricIds) {
            if (!existingByMetricId.containsKey(metricId)) {
                Map<String, Object> signalEntry = (Map<String, Object>) newSignalMap.get(String.valueOf(metricId));
                createFromSignalMapEntry(assetId, deviceId, metricId, signalEntry, tenantId);
                created++;
            }
        }
        log.info("Reconcile signal map for asset {}: created {} metric points", assetId, created);
    }

    private void updateMetricPointFromSignalEntry(MetricPoint mp, Map<String, Object> signalEntry, String deviceId) {
        String name   = (String) signalEntry.getOrDefault("name", "metric_" + mp.getMetricId());
        String unit   = (String) signalEntry.getOrDefault("unit", "");
        String source = (String) signalEntry.get("source");
        String field  = (String) signalEntry.get("field");
        Double min    = signalEntry.get("min") instanceof Number n ? n.doubleValue() : null;
        Double max    = signalEntry.get("max") instanceof Number n ? n.doubleValue() : null;

        mp.setDeviceId(deviceId);
        mp.setUnit(unit);
        if (source != null) mp.setSource(source);
        if (field  != null) mp.setField(field);
        if (min    != null) mp.setMinValue(min);
        if (max    != null) mp.setMaxValue(max);
        mp.setUpdatedAt(Instant.now());
        metricPointRepository.save(mp);

        // Update display name on the ontology object
        ontologyService.updateDisplayName(mp.getId(), name);

        // Re-resolve MEASURES link if the name (which drives physical quantity) changed
        ontologyService.deleteOutboundLinksOfType(mp.getId(), OntologyService.MEASURES);
        Optional<PhysicalQuantity> pq = physicalQuantityService.resolveByName(name);
        if (pq.isPresent()) {
            mp.setQuantityId(pq.get().getId());
            metricPointRepository.save(mp);
            ontologyService.upsertLink(mp.getId(), pq.get().getId(), OntologyService.MEASURES);
        }
    }

    private void deleteMetricPointFully(MetricPoint mp) {
        UUID mpId = mp.getId();
        log.info("Deleting metric point fully: {} (metricId={})", mpId, mp.getMetricId());
        ontologyService.deleteObject(mpId);
    }
}
