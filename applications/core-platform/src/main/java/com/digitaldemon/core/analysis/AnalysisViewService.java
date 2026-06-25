package com.digitaldemon.core.analysis;

import com.digitaldemon.core.analysis.AnalysisView;
import com.digitaldemon.core.common.exception.ResourceNotFoundException;
import com.digitaldemon.core.common.exception.ValidationException;
import com.digitaldemon.core.analysis.AnalysisViewRepository;
import com.digitaldemon.core.project.ProjectRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Slf4j
@Transactional(readOnly = true)
public class AnalysisViewService {

    private final AnalysisViewRepository analysisViewRepository;
    private final ProjectRepository projectRepository;

    public record AnalysisViewDTO(
        UUID id,
        UUID projectId,
        String name,
        String definition,
        Instant createdAt,
        Instant updatedAt
    ) {}

    public record CreateAnalysisViewRequest(
        String name,
        String definition
    ) {}

    public record UpdateAnalysisViewRequest(
        String name,
        String definition
    ) {}

    public List<AnalysisViewDTO> listViews(UUID projectId) {
        if (!projectRepository.existsById(projectId)) {
            throw new ResourceNotFoundException("Project", projectId);
        }
        return analysisViewRepository.findByProjectIdOrderByUpdatedAtDesc(projectId)
            .stream().map(this::toDTO).collect(Collectors.toList());
    }

    public AnalysisViewDTO getView(UUID viewId) {
        AnalysisView v = analysisViewRepository.findById(viewId)
            .orElseThrow(() -> new ResourceNotFoundException("AnalysisView", viewId));
        return toDTO(v);
    }

    @Transactional
    public AnalysisViewDTO createView(UUID projectId, CreateAnalysisViewRequest request) {
        if (!projectRepository.existsById(projectId)) {
            throw new ResourceNotFoundException("Project", projectId);
        }
        if (request.name() == null || request.name().isBlank()) {
            throw new ValidationException("Analysis view name is required");
        }

        AnalysisView v = new AnalysisView();
        v.setProjectId(projectId);
        v.setName(request.name().trim());

        if (request.definition() != null && !request.definition().isBlank()) {
            v.setDefinition(request.definition());
        }

        v.setCreatedAt(Instant.now());
        v.setUpdatedAt(Instant.now());

        AnalysisView saved = analysisViewRepository.save(v);
        log.info("Created analysis view '{}' (id: {}) for project {}", saved.getName(), saved.getId(), projectId);
        return toDTO(saved);
    }

    @Transactional
    public AnalysisViewDTO updateView(UUID viewId, UpdateAnalysisViewRequest request) {
        AnalysisView v = analysisViewRepository.findById(viewId)
            .orElseThrow(() -> new ResourceNotFoundException("AnalysisView", viewId));

        if (request.name() != null && !request.name().isBlank()) {
            v.setName(request.name().trim());
        }
        if (request.definition() != null && !request.definition().isBlank()) {
            v.setDefinition(request.definition());
        }
        v.setUpdatedAt(Instant.now());

        AnalysisView saved = analysisViewRepository.save(v);
        log.info("Updated analysis view '{}' (id: {})", saved.getName(), saved.getId());
        return toDTO(saved);
    }

    @Transactional
    public void deleteView(UUID viewId) {
        if (!analysisViewRepository.existsById(viewId)) {
            throw new ResourceNotFoundException("AnalysisView", viewId);
        }
        analysisViewRepository.deleteById(viewId);
        log.info("Deleted analysis view: {}", viewId);
    }

    private AnalysisViewDTO toDTO(AnalysisView v) {
        return new AnalysisViewDTO(
            v.getId(),
            v.getProjectId(),
            v.getName(),
            v.getDefinition(),
            v.getCreatedAt(),
            v.getUpdatedAt()
        );
    }
}
