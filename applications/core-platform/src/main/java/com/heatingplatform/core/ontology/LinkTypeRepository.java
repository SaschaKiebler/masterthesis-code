package com.heatingplatform.core.ontology;

import com.heatingplatform.core.ontology.LinkType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface LinkTypeRepository extends JpaRepository<LinkType, UUID> {

    Optional<LinkType> findByName(String name);
}
