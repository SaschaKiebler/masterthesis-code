package com.digitaldemon.core.audit;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface AccessAuditRepository extends JpaRepository<AccessAudit, UUID> {

    /** Trail of one caller, surfaced by the GDPR export (retained on erasure). */
    java.util.List<AccessAudit> findBySubject(String subject);
}
