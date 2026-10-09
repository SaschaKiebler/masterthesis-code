package com.heatingplatform.core.physicalquantity;

import com.heatingplatform.core.physicalquantity.PhysicalQuantity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface PhysicalQuantityRepository extends JpaRepository<PhysicalQuantity, UUID> {

    Optional<PhysicalQuantity> findByName(String name);

    List<PhysicalQuantity> findByDimension(String dimension);

    List<PhysicalQuantity> findByDomain(String domain);

    List<PhysicalQuantity> findByDimensionAndDomain(String dimension, String domain);
}
