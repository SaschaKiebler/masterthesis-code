package com.heatingplatform.core.device;

import com.heatingplatform.core.device.DeviceTemplate;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface DeviceTemplateRepository extends JpaRepository<DeviceTemplate, UUID> {
    
    @Query("SELECT dt FROM DeviceTemplate dt LEFT JOIN FETCH dt.objectType WHERE dt.active = true AND (dt.tenant IS NULL OR dt.tenant.id = :tenantId) ORDER BY dt.sortOrder")
    List<DeviceTemplate> findAllActiveByTenant(UUID tenantId);
    
    @Query("SELECT dt FROM DeviceTemplate dt LEFT JOIN FETCH dt.objectType WHERE dt.active = true AND dt.tenant IS NULL ORDER BY dt.sortOrder")
    List<DeviceTemplate> findAllActiveSystemDefaults();
    
    @Query("SELECT dt FROM DeviceTemplate dt LEFT JOIN FETCH dt.objectType WHERE dt.active = true AND dt.protocol = :protocol AND (dt.tenant IS NULL OR dt.tenant.id = :tenantId) ORDER BY dt.sortOrder")
    List<DeviceTemplate> findAllActiveByProtocolAndTenant(String protocol, UUID tenantId);
}
