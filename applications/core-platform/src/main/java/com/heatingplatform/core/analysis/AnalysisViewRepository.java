package com.heatingplatform.core.analysis;

import com.heatingplatform.core.analysis.AnalysisView;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface AnalysisViewRepository extends JpaRepository<AnalysisView, UUID> {
    List<AnalysisView> findByProjectIdOrderByUpdatedAtDesc(UUID projectId);
}
