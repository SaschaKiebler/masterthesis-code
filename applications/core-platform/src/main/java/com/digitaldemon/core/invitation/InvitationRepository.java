package com.digitaldemon.core.invitation;

import com.digitaldemon.core.invitation.Invitation;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface InvitationRepository extends JpaRepository<Invitation, UUID> {

    Optional<Invitation> findByToken(String token);

    List<Invitation> findByEmailAndAcceptedAtIsNull(String email);

    List<Invitation> findByTenantId(UUID tenantId);

    List<Invitation> findByTenantIdIn(List<UUID> tenantIds);
}
