package com.heatingplatform.core.event;

import com.heatingplatform.core.event.EventTemplate;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface EventTemplateRepository extends JpaRepository<EventTemplate, UUID> {

    List<EventTemplate> findByTenantIdIsNullOrTenantIdOrderBySortOrder(UUID tenantId);

    List<EventTemplate> findByTenantIdOrderBySortOrder(UUID tenantId);

    List<EventTemplate> findByTenantIdIsNullOrderBySortOrder();
}
