package com.digitaldemon.core.site;

import com.digitaldemon.core.user.User;
import com.digitaldemon.core.ontology.ObjectEntity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "site_assignments")
@Data
public class SiteAssignment {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "site_id", nullable = false)
    private ObjectEntity site;

    @Column(name = "assigned_by")
    private UUID assignedBy;

    @Column
    private String notes;

    @Column(name = "created_at")
    private Instant createdAt;
}
