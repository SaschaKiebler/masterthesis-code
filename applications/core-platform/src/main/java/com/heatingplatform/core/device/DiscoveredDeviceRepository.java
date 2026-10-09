package com.heatingplatform.core.device;

import org.springframework.data.jpa.repository.JpaRepository;

public interface DiscoveredDeviceRepository extends JpaRepository<DiscoveredDevice, String> {
}
