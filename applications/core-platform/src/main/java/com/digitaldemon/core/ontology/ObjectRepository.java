package com.digitaldemon.core.ontology;

import com.digitaldemon.core.ontology.ObjectEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface ObjectRepository extends JpaRepository<ObjectEntity, UUID> {

    @Query("SELECT o FROM ObjectEntity o JOIN FETCH o.objectType WHERE o.id IN :ids")
    List<ObjectEntity> findAllWithTypeByIdIn(@Param("ids") Collection<UUID> ids);

    @Query("SELECT o FROM ObjectEntity o JOIN FETCH o.objectType WHERE o.objectType.name = :typeName")
    List<ObjectEntity> findByObjectTypeName(@Param("typeName") String typeName);

    @Query("SELECT o FROM ObjectEntity o JOIN FETCH o.objectType WHERE o.tenant.id = :tenantId AND o.objectType.name = :typeName")
    List<ObjectEntity> findByTenantIdAndObjectTypeName(@Param("tenantId") UUID tenantId, @Param("typeName") String typeName);

    @Query("SELECT o FROM ObjectEntity o JOIN FETCH o.objectType WHERE o.id IN :ids AND o.objectType.name = :typeName")
    List<ObjectEntity> findByIdInAndObjectTypeName(@Param("ids") Collection<UUID> ids, @Param("typeName") String typeName);

    @Query("SELECT o FROM ObjectEntity o JOIN FETCH o.objectType JOIN FETCH o.tenant WHERE o.objectType.name = :typeName")
    List<ObjectEntity> findAllWithTenantByObjectTypeName(@Param("typeName") String typeName);

    @Query("SELECT o FROM ObjectEntity o JOIN FETCH o.objectType JOIN FETCH o.tenant WHERE o.tenant.id IN :tenantIds AND o.objectType.name = :typeName")
    List<ObjectEntity> findByTenantIdsWithTenantAndObjectTypeName(@Param("tenantIds") List<UUID> tenantIds, @Param("typeName") String typeName);

    @Query("SELECT o FROM ObjectEntity o JOIN FETCH o.objectType JOIN FETCH o.tenant WHERE o.id IN :ids")
    List<ObjectEntity> findByIdsWithTenant(@Param("ids") Collection<UUID> ids);

    @Query("SELECT o.id FROM ObjectEntity o WHERE o.tenant.id IN :tenantIds AND o.objectType.name = :typeName")
    List<UUID> findIdsByTenantIdsAndObjectTypeName(@Param("tenantIds") List<UUID> tenantIds, @Param("typeName") String typeName);

    Optional<ObjectEntity> findByDisplayName(String displayName);

    /**
     * Direct tenant_id lookup without loading the full entity graph.
     * Used by background evaluators (MQTT thread) where lazy-loading proxies
     * would fail outside an open Hibernate session.
     */
    @Query(value = "SELECT tenant_id FROM objects WHERE id = :objectId", nativeQuery = true)
    Optional<UUID> findTenantIdByObjectId(@Param("objectId") UUID objectId);
}
