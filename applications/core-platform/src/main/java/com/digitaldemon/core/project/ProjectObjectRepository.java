package com.digitaldemon.core.project;

import com.digitaldemon.core.project.ProjectObject;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface ProjectObjectRepository extends JpaRepository<ProjectObject, ProjectObject.ProjectObjectId> {

    List<ProjectObject> findByProjectId(UUID projectId);

    @Query("SELECT po.objectId FROM ProjectObject po WHERE po.projectId = :projectId")
    List<UUID> findObjectIdsByProjectId(@Param("projectId") UUID projectId);

    void deleteByProjectIdAndObjectId(UUID projectId, UUID objectId);

    boolean existsByProjectIdAndObjectId(UUID projectId, UUID objectId);
}
