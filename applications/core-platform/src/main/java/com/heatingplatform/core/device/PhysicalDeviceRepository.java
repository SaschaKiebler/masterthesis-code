package com.heatingplatform.core.device;

import com.heatingplatform.core.device.PhysicalDevice;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

@Repository
public interface PhysicalDeviceRepository extends JpaRepository<PhysicalDevice, UUID> {

    Optional<PhysicalDevice> findByDeviceId(String deviceId);

    boolean existsByDeviceId(String deviceId);
}
