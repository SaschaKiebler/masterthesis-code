package com.digitaldemon.core.invitation;

import jakarta.persistence.*;
import lombok.Data;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "invitations")
@Data
public class Invitation {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false)
    private String email;

    @Column(name = "tenant_id")
    private UUID tenantId;

    @Column(name = "tenant_role", nullable = false)
    private String tenantRole = "viewer";

    @Column(name = "global_role", nullable = false)
    private String globalRole = "viewer";

    @Column(name = "invited_by", nullable = false)
    private UUID invitedBy;

    @Column(unique = true, nullable = false)
    private String token;

    @Column(name = "accepted_at")
    private Instant acceptedAt;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "created_at")
    private Instant createdAt;

    @Transient
    public boolean isExpired() {
        return Instant.now().isAfter(expiresAt);
    }

    @Transient
    public boolean isAccepted() {
        return acceptedAt != null;
    }
}
