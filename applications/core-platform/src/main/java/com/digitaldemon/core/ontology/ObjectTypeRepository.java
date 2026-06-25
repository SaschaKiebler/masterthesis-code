package com.digitaldemon.core.ontology;

import com.digitaldemon.core.ontology.ObjectType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface ObjectTypeRepository extends JpaRepository<ObjectType, UUID> {
    
    @Query("SELECT ot FROM ObjectType ot WHERE ot.active = true AND (ot.tenant IS NULL OR ot.tenant.id = :tenantId) ORDER BY ot.sortOrder")
    List<ObjectType> findAllActiveByTenant(UUID tenantId);
    
    @Query("SELECT ot FROM ObjectType ot WHERE ot.active = true AND ot.tenant IS NULL ORDER BY ot.sortOrder")
    List<ObjectType> findAllActiveSystemDefaults();

    @Query("SELECT ot FROM ObjectType ot WHERE ot.tenant IS NULL AND ot.name = :name")
    Optional<ObjectType> findSystemTypeByName(String name);
}
