package com.heatingplatform.core.derivedproperty;

import com.heatingplatform.core.derivedproperty.DerivedProperty;
import com.heatingplatform.core.derivedproperty.DerivedPropertyRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Slf4j
@Transactional(readOnly = true)
public class DerivedPropertyService {

    private final DerivedPropertyRepository derivedPropertyRepository;

    @PersistenceContext
    private EntityManager entityManager;

    /**
     * Get all current derived properties for an object.
     */
    public List<DerivedProperty> getCurrentProperties(UUID objectId) {
        return derivedPropertyRepository.findByObjectIdAndValidUntilIsNull(objectId);
    }

    /**
     * Get a specific current derived property.
     * If duplicates exist (race condition), returns the most recently computed one.
     */
    public Optional<DerivedProperty> getCurrentProperty(UUID objectId, String propertyName) {
        List<DerivedProperty> current = derivedPropertyRepository
                .findByObjectIdAndPropertyNameAndValidUntilIsNull(objectId, propertyName);
        if (current.isEmpty()) return Optional.empty();
        if (current.size() == 1) return Optional.of(current.get(0));
        // Multiple current rows — return the newest
        return current.stream()
                .max((a, b) -> a.getComputedAt().compareTo(b.getComputedAt()));
    }

    /**
     * Get all current values for a property name across all objects of given types in a tenant.
     * Used by dashboard widgets and alert rules.
     */
    public List<DerivedProperty> getByPropertyAndObjectTypes(String propertyName,
                                                              List<String> objectTypeNames,
                                                              UUID tenantId) {
        return derivedPropertyRepository.findCurrentByPropertyAndObjectTypes(
            propertyName, objectTypeNames.toArray(new String[0]), tenantId);
    }

    /**
     * Get all current derived properties for a tenant.
     */
    public List<DerivedProperty> getAllCurrentByTenant(UUID tenantId) {
        return derivedPropertyRepository.findByTenantIdAndValidUntilIsNull(tenantId);
    }

    /**
     * Get degraded (stale or low-confidence) properties for monitoring.
     */
    public List<DerivedProperty> getDegradedProperties(UUID tenantId) {
        return derivedPropertyRepository.findDegradedByTenant(tenantId);
    }

    /**
     * Get historical values for an object's property (for audit / trend display).
     */
    public List<DerivedProperty> getHistory(UUID objectId, String propertyName) {
        return derivedPropertyRepository.findByObjectIdAndPropertyNameOrderByValidFromDesc(
            objectId, propertyName);
    }

    /**
     * Get historical values within a time range (for time series charts).
     */
    public List<DerivedProperty> getHistoryInRange(UUID objectId, String propertyName,
                                                    long fromEpochSeconds, long toEpochSeconds) {
        return derivedPropertyRepository.findHistoryInRange(
            objectId, propertyName, fromEpochSeconds, toEpochSeconds);
    }

    /**
     * Write a new derived property value for an object.
     * Expires the previous current value (sets valid_until = NOW()) and inserts the new row.
     * This is the main entry point for ML pipelines and analytics runners.
     */
    @Transactional
    public DerivedProperty writeProperty(UUID objectId, String propertyName, String displayName,
                                          Double valueNumeric, String valueText,
                                          String unit, Double confidence, String quality,
                                          String sourceType, String sourceId, String sourceVersion,
                                          UUID tenantId) {
        Instant now = Instant.now();

        // Serialize concurrent writers for the same (object, property) pair.
        // pg_advisory_xact_lock auto-releases at end of transaction; the lock key is derived
        // from object+property so different properties are not blocked.
        long lockKey = computeLockKey(objectId, propertyName);
        entityManager.createNativeQuery("SELECT pg_advisory_xact_lock(?1)")
                .setParameter(1, lockKey)
                .getSingleResult();

        // Expire all current values (there may be duplicates from a pre-lock race window)
        List<DerivedProperty> currentRows = derivedPropertyRepository
                .findByObjectIdAndPropertyNameAndValidUntilIsNull(objectId, propertyName);
        for (DerivedProperty existing : currentRows) {
            existing.setValidUntil(now);
            derivedPropertyRepository.save(existing);
        }
        // Flush expirations before insert so the partial unique index sees an empty slot.
        if (!currentRows.isEmpty()) {
            entityManager.flush();
        }

        // Insert new value
        DerivedProperty dp = new DerivedProperty();
        dp.setObjectId(objectId);
        dp.setPropertyName(propertyName);
        dp.setDisplayName(displayName != null ? displayName : propertyName);
        dp.setValueNumeric(valueNumeric);
        dp.setValueText(valueText);
        dp.setUnit(unit);
        dp.setConfidence(confidence);
        dp.setQuality(quality != null ? quality : "GOOD");
        dp.setSourceType(sourceType);
        dp.setSourceId(sourceId);
        dp.setSourceVersion(sourceVersion);
        dp.setComputedAt(now);
        dp.setValidFrom(now);
        dp.setValidUntil(null);
        dp.setTenantId(tenantId);

        DerivedProperty saved = derivedPropertyRepository.save(dp);
        log.debug("Wrote derived property: {}.{} = {} (source: {})", objectId, propertyName,
            valueNumeric != null ? valueNumeric : valueText, sourceType);
        return saved;
    }

    /**
     * Mark a derived property as stale (e.g., when the pipeline that computes it failed).
     */
    @Transactional
    public void markStale(UUID objectId, String propertyName) {
        long lockKey = computeLockKey(objectId, propertyName);
        entityManager.createNativeQuery("SELECT pg_advisory_xact_lock(?1)")
                .setParameter(1, lockKey)
                .getSingleResult();

        List<DerivedProperty> currentRows = derivedPropertyRepository
                .findByObjectIdAndPropertyNameAndValidUntilIsNull(objectId, propertyName);
        for (DerivedProperty dp : currentRows) {
            dp.setQuality("STALE");
            derivedPropertyRepository.save(dp);
        }
    }

    private static long computeLockKey(UUID objectId, String propertyName) {
        return objectId.getMostSignificantBits()
                ^ objectId.getLeastSignificantBits()
                ^ ((long) propertyName.hashCode() << 1);
    }
}
