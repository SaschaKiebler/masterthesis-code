package com.digitaldemon.core.ontology;

import com.digitaldemon.core.ontology.Link;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface LinkRepository extends JpaRepository<Link, UUID> {

    @Query("SELECT l FROM Link l JOIN FETCH l.target WHERE l.source.id = :sourceId AND l.linkType.id = :linkTypeId")
    List<Link> findBySourceAndLinkType(@Param("sourceId") UUID sourceId, @Param("linkTypeId") UUID linkTypeId);

    @Query("SELECT l FROM Link l JOIN FETCH l.source WHERE l.target.id = :targetId AND l.linkType.id = :linkTypeId")
    List<Link> findByTargetAndLinkType(@Param("targetId") UUID targetId, @Param("linkTypeId") UUID linkTypeId);

    @Query("SELECT COUNT(l) > 0 FROM Link l WHERE l.source.id = :sourceId AND l.target.id = :targetId AND l.linkType.id = :linkTypeId")
    boolean existsBySourceTargetAndType(
            @Param("sourceId") UUID sourceId,
            @Param("targetId") UUID targetId,
            @Param("linkTypeId") UUID linkTypeId);

    @Modifying
    @Query("DELETE FROM Link l WHERE l.source.id = :sourceId AND l.linkType.id = :linkTypeId")
    void deleteBySourceAndLinkType(@Param("sourceId") UUID sourceId, @Param("linkTypeId") UUID linkTypeId);

    @Modifying
    @Query("DELETE FROM Link l WHERE l.target.id = :targetId AND l.linkType.id = :linkTypeId")
    void deleteByTargetAndLinkType(@Param("targetId") UUID targetId, @Param("linkTypeId") UUID linkTypeId);

    @Query("SELECT l FROM Link l JOIN FETCH l.linkType JOIN FETCH l.source s JOIN FETCH s.objectType JOIN FETCH l.target t JOIN FETCH t.objectType WHERE l.source.id = :objectId ORDER BY l.linkType.name, l.createdAt")
    List<Link> findOutboundByObjectId(@Param("objectId") UUID objectId);

    @Query("SELECT l FROM Link l JOIN FETCH l.linkType JOIN FETCH l.source s JOIN FETCH s.objectType JOIN FETCH l.target t JOIN FETCH t.objectType WHERE l.target.id = :objectId ORDER BY l.linkType.name, l.createdAt")
    List<Link> findInboundByObjectId(@Param("objectId") UUID objectId);

    @Query("SELECT l FROM Link l JOIN FETCH l.linkType JOIN FETCH l.source s JOIN FETCH s.objectType JOIN FETCH l.target t JOIN FETCH t.objectType WHERE l.source.id = :sourceId AND l.target.id = :targetId AND l.linkType.id = :linkTypeId")
    Optional<Link> findBySourceTargetAndType(
            @Param("sourceId") UUID sourceId,
            @Param("targetId") UUID targetId,
            @Param("linkTypeId") UUID linkTypeId);

    @Query("SELECT l FROM Link l JOIN FETCH l.linkType JOIN FETCH l.source s JOIN FETCH s.objectType JOIN FETCH l.target t JOIN FETCH t.objectType WHERE l.source.id IN :ids AND l.target.id IN :ids ORDER BY l.linkType.name")
    List<Link> findAllWithinObjectIds(@Param("ids") Collection<UUID> ids);

    // ─── Phase D: link-based resolvers (replace FK columns) ──────────────────

    /** Resolve the single target of a link (e.g. asset → INSTALLED_AT → building). */
    @Query("SELECT l.target.id FROM Link l WHERE l.source.id = :sourceId AND l.linkType.id = :linkTypeId")
    Optional<UUID> findTargetId(@Param("sourceId") UUID sourceId, @Param("linkTypeId") UUID linkTypeId);

    /** Resolve the single source of a link (e.g. space ← CONTAINS ← parent). */
    @Query("SELECT l.source.id FROM Link l WHERE l.target.id = :targetId AND l.linkType.id = :linkTypeId")
    List<UUID> findSourceIds(@Param("targetId") UUID targetId, @Param("linkTypeId") UUID linkTypeId);

    /** Count how many objects link to a target via a given type (replaces countBySiteId). */
    @Query("SELECT COUNT(l) FROM Link l WHERE l.target.id = :targetId AND l.linkType.id = :linkTypeId")
    int countByTargetAndLinkType(@Param("targetId") UUID targetId, @Param("linkTypeId") UUID linkTypeId);

    /** Find all source IDs linking to a target via a given type (e.g. all assets INSTALLED_AT a site). */
    @Query("SELECT l.source.id FROM Link l WHERE l.target.id = :targetId AND l.linkType.id = :linkTypeId")
    List<UUID> findSourceIdsByTargetAndType(@Param("targetId") UUID targetId, @Param("linkTypeId") UUID linkTypeId);
}
