package com.digitaldemon.core.analysis;

import com.digitaldemon.core.analysis.AnalysisTemplate;
import com.digitaldemon.core.common.exception.ResourceNotFoundException;
import com.digitaldemon.core.common.exception.ValidationException;
import com.digitaldemon.core.analysis.AnalysisTemplateRepository;
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
public class AnalysisTemplateService {

    private final AnalysisTemplateRepository analysisTemplateRepository;

    public record AnalysisTemplateDTO(
        UUID id,
        UUID tenantId,
        String name,
        String description,
        String category,
        boolean isSystem,
        String definition,
        Instant createdAt,
        Instant updatedAt
    ) {}

    public record CreateAnalysisTemplateRequest(
        String name,
        String description,
        String category,
        String definition
    ) {}

    public record UpdateAnalysisTemplateRequest(
        String name,
        String description,
        String category,
        String definition
    ) {}

    public List<AnalysisTemplateDTO> listTemplates(UUID tenantId) {
        List<AnalysisTemplate> templates;
        if (tenantId != null) {
            templates = analysisTemplateRepository.findByTenantIdOrSystemTrueOrderByNameAsc(tenantId);
        } else {
            templates = analysisTemplateRepository.findBySystemTrueOrderByNameAsc();
        }
        return templates.stream().map(this::toDTO).collect(Collectors.toList());
    }

    public AnalysisTemplateDTO getTemplate(UUID templateId) {
        AnalysisTemplate t = analysisTemplateRepository.findById(templateId)
            .orElseThrow(() -> new ResourceNotFoundException("AnalysisTemplate", templateId));
        return toDTO(t);
    }

    @Transactional
    public AnalysisTemplateDTO createTemplate(UUID tenantId, CreateAnalysisTemplateRequest request) {
        if (request.name() == null || request.name().isBlank()) {
            throw new ValidationException("Analysis template name is required");
        }

        AnalysisTemplate t = new AnalysisTemplate();
        t.setTenantId(tenantId);
        t.setName(request.name().trim());
        t.setDescription(request.description());
        t.setCategory(request.category());
        t.setSystem(false);

        if (request.definition() != null && !request.definition().isBlank()) {
            t.setDefinition(request.definition());
        }

        t.setCreatedAt(Instant.now());
        t.setUpdatedAt(Instant.now());

        AnalysisTemplate saved = analysisTemplateRepository.save(t);
        log.info("Created analysis template '{}' (id: {}) for tenant {}", saved.getName(), saved.getId(), tenantId);
        return toDTO(saved);
    }

    @Transactional
    public AnalysisTemplateDTO updateTemplate(UUID templateId, UpdateAnalysisTemplateRequest request) {
        AnalysisTemplate t = analysisTemplateRepository.findById(templateId)
            .orElseThrow(() -> new ResourceNotFoundException("AnalysisTemplate", templateId));

        if (t.isSystem()) {
            throw new ValidationException("System templates cannot be modified");
        }

        if (request.name() != null && !request.name().isBlank()) {
            t.setName(request.name().trim());
        }
        if (request.description() != null) {
            t.setDescription(request.description().isBlank() ? null : request.description());
        }
        if (request.category() != null) {
            t.setCategory(request.category().isBlank() ? null : request.category());
        }
        if (request.definition() != null && !request.definition().isBlank()) {
            t.setDefinition(request.definition());
        }
        t.setUpdatedAt(Instant.now());

        AnalysisTemplate saved = analysisTemplateRepository.save(t);
        log.info("Updated analysis template '{}' (id: {})", saved.getName(), saved.getId());
        return toDTO(saved);
    }

    @Transactional
    public void deleteTemplate(UUID templateId) {
        AnalysisTemplate t = analysisTemplateRepository.findById(templateId)
            .orElseThrow(() -> new ResourceNotFoundException("AnalysisTemplate", templateId));
        if (t.isSystem()) {
            throw new ValidationException("System templates cannot be deleted");
        }
        analysisTemplateRepository.deleteById(templateId);
        log.info("Deleted analysis template: {}", templateId);
    }

    private AnalysisTemplateDTO toDTO(AnalysisTemplate t) {
        return new AnalysisTemplateDTO(
            t.getId(),
            t.getTenantId(),
            t.getName(),
            t.getDescription(),
            t.getCategory(),
            t.isSystem(),
            t.getDefinition(),
            t.getCreatedAt(),
            t.getUpdatedAt()
        );
    }
}
