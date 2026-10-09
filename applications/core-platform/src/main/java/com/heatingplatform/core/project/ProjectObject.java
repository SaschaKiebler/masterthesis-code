package com.heatingplatform.core.project;

import jakarta.persistence.*;
import lombok.Data;
import java.io.Serializable;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "project_objects")
@Data
@IdClass(ProjectObject.ProjectObjectId.class)
public class ProjectObject {

    @Id
    @Column(name = "project_id")
    private UUID projectId;

    @Id
    @Column(name = "object_id")
    private UUID objectId;

    @Column(name = "added_at")
    private Instant addedAt;

    @Data
    public static class ProjectObjectId implements Serializable {
        private UUID projectId;
        private UUID objectId;
    }
}
