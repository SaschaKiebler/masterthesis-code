package com.heatingplatform.core.dashboard;

import com.heatingplatform.core.dashboard.Dashboard;
import com.heatingplatform.core.common.exception.ResourceNotFoundException;
import com.heatingplatform.core.common.exception.ValidationException;
import com.heatingplatform.core.dashboard.DashboardRepository;
import com.heatingplatform.core.project.ProjectRepository;
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
public class DashboardService {

    private final DashboardRepository dashboardRepository;
    private final ProjectRepository projectRepository;

    public record DashboardDTO(
        UUID id,
        UUID projectId,
        String name,
        int sortOrder,
        String scopeType,
        UUID scopeId,
        String layout,
        Instant createdAt,
        Instant updatedAt
    ) {}

    public record CreateDashboardRequest(
        String name,
        int sortOrder,
        String scopeType,
        UUID scopeId,
        String layout
    ) {}

    public record UpdateDashboardRequest(
        String name,
        Integer sortOrder,
        String scopeType,
        UUID scopeId,
        String layout
    ) {}

    public List<DashboardDTO> listDashboards(UUID projectId) {
        if (!projectRepository.existsById(projectId)) {
            throw new ResourceNotFoundException("Project", projectId);
        }
        return dashboardRepository.findByProjectIdOrderBySortOrderAsc(projectId)
            .stream().map(this::toDTO).collect(Collectors.toList());
    }

    public DashboardDTO getDashboard(UUID dashboardId) {
        Dashboard d = dashboardRepository.findById(dashboardId)
            .orElseThrow(() -> new ResourceNotFoundException("Dashboard", dashboardId));
        return toDTO(d);
    }

    @Transactional
    public DashboardDTO createDashboard(UUID projectId, CreateDashboardRequest request) {
        if (!projectRepository.existsById(projectId)) {
            throw new ResourceNotFoundException("Project", projectId);
        }
        if (request.name() == null || request.name().isBlank()) {
            throw new ValidationException("Dashboard name is required");
        }

        Dashboard d = new Dashboard();
        d.setProjectId(projectId);
        d.setName(request.name().trim());
        d.setSortOrder(request.sortOrder());
        d.setScopeType(request.scopeType());
        d.setScopeId(request.scopeId());
        
        if (request.layout() != null && !request.layout().isBlank()) {
            d.setLayout(request.layout());
        } else {
            d.setLayout("{\"columns\":2,\"widgets\":[]}");
        }
        
        d.setCreatedAt(Instant.now());
        d.setUpdatedAt(Instant.now());

        Dashboard saved = dashboardRepository.save(d);
        log.info("Created dashboard '{}' (id: {}) for project {}", saved.getName(), saved.getId(), projectId);
        return toDTO(saved);
    }

    @Transactional
    public DashboardDTO updateDashboard(UUID dashboardId, UpdateDashboardRequest request) {
        Dashboard d = dashboardRepository.findById(dashboardId)
            .orElseThrow(() -> new ResourceNotFoundException("Dashboard", dashboardId));

        if (request.name() != null && !request.name().isBlank()) {
            d.setName(request.name().trim());
        }
        if (request.sortOrder() != null) {
            d.setSortOrder(request.sortOrder());
        }
        if (request.scopeType() != null) {
            d.setScopeType(request.scopeType().isBlank() ? null : request.scopeType());
        }
        if (request.scopeId() != null) {
            d.setScopeId(request.scopeId());
        } else if (request.scopeType() == null || request.scopeType().isBlank()) {
             d.setScopeId(null);
        }
        if (request.layout() != null && !request.layout().isBlank()) {
            d.setLayout(request.layout());
        }
        d.setUpdatedAt(Instant.now());

        Dashboard saved = dashboardRepository.save(d);
        log.info("Updated dashboard '{}' (id: {})", saved.getName(), saved.getId());
        return toDTO(saved);
    }

    @Transactional
    public void deleteDashboard(UUID dashboardId) {
        if (!dashboardRepository.existsById(dashboardId)) {
            throw new ResourceNotFoundException("Dashboard", dashboardId);
        }
        dashboardRepository.deleteById(dashboardId);
        log.info("Deleted dashboard: {}", dashboardId);
    }

    private DashboardDTO toDTO(Dashboard d) {
        return new DashboardDTO(
            d.getId(),
            d.getProjectId(),
            d.getName(),
            d.getSortOrder(),
            d.getScopeType(),
            d.getScopeId(),
            d.getLayout(),
            d.getCreatedAt(),
            d.getUpdatedAt()
        );
    }
}
