package com.digitaldemon.core.site;

import com.digitaldemon.core.site.SiteAssignment;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface SiteAssignmentRepository extends JpaRepository<SiteAssignment, UUID> {

    List<SiteAssignment> findByUserId(UUID userId);

    @Query("SELECT sa.site.id FROM SiteAssignment sa WHERE sa.user.id = :userId")
    List<UUID> findSiteIdsByUserId(UUID userId);

    boolean existsByUserIdAndSiteId(UUID userId, UUID siteId);
}
