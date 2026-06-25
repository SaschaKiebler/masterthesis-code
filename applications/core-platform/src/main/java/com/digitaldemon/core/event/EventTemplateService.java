package com.digitaldemon.core.event;

import com.digitaldemon.core.event.EventTemplate;
import com.digitaldemon.core.common.exception.ResourceNotFoundException;
import com.digitaldemon.core.event.EventTemplateRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Slf4j
@Transactional(readOnly = true)
public class EventTemplateService {

    private final EventTemplateRepository repository;

    /**
     * Returns system defaults (tenant_id IS NULL) + tenant-specific templates, ordered by sort_order.
     */
    public List<EventTemplate> getTemplatesForTenant(UUID tenantId) {
        if (tenantId == null) {
            return repository.findByTenantIdIsNullOrderBySortOrder();
        }
        return repository.findByTenantIdIsNullOrTenantIdOrderBySortOrder(tenantId);
    }

    /**
     * Create a tenant-scoped event template.
     */
    @Transactional
    public EventTemplate createTemplate(UUID tenantId, String label, String eventType,
                                         String severity, String summary, int sortOrder) {
        EventTemplate template = new EventTemplate();
        template.setTenantId(tenantId);
        template.setLabel(label);
        template.setEventType(eventType);
        template.setSeverity(severity != null ? severity : "INFO");
        template.setSummary(summary);
        template.setSortOrder(sortOrder);
        template = repository.save(template);
        log.info("Created event template: id={}, label={}, tenant={}", template.getId(), label, tenantId);
        return template;
    }

    /**
     * Update a tenant-scoped event template. System defaults (tenant_id IS NULL) cannot be edited.
     */
    @Transactional
    public EventTemplate updateTemplate(UUID id, String label, String eventType,
                                         String severity, String summary, Integer sortOrder) {
        EventTemplate template = repository.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException("Event template not found: " + id));

        if (template.getTenantId() == null) {
            throw new IllegalStateException("System default templates cannot be edited");
        }

        if (label != null) template.setLabel(label);
        if (eventType != null) template.setEventType(eventType);
        if (severity != null) template.setSeverity(severity);
        if (summary != null) template.setSummary(summary);
        if (sortOrder != null) template.setSortOrder(sortOrder);

        template = repository.save(template);
        log.info("Updated event template: id={}", id);
        return template;
    }

    /**
     * Delete a tenant-scoped event template. System defaults cannot be deleted.
     */
    @Transactional
    public void deleteTemplate(UUID id) {
        EventTemplate template = repository.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException("Event template not found: " + id));

        if (template.getTenantId() == null) {
            throw new IllegalStateException("System default templates cannot be deleted");
        }

        repository.delete(template);
        log.info("Deleted event template: id={}", id);
    }
}
