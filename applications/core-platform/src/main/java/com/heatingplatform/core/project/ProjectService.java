package com.heatingplatform.core.project;

import com.heatingplatform.core.tenant.Tenant;
import com.heatingplatform.core.ontology.ObjectEntity;
import com.heatingplatform.core.ontology.Link;
import com.heatingplatform.core.dashboard.Dashboard;
import com.heatingplatform.core.ontology.OntologyService;
import com.heatingplatform.core.tenant.TenantRepository;
import com.heatingplatform.core.ontology.ObjectRepository;
import com.heatingplatform.core.ontology.LinkRepository;
import com.heatingplatform.core.dashboard.DashboardRepository;
import com.heatingplatform.core.measurement.ChannelResolver;
import com.heatingplatform.core.measurement.LatestValueProjection;
import com.heatingplatform.core.fleet.FleetService;
import com.heatingplatform.core.common.exception.ResourceNotFoundException;
import com.heatingplatform.core.common.exception.ValidationException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Slf4j
@Transactional(readOnly = true)
public class ProjectService {

    private final ProjectRepository projectRepository;
    private final ProjectObjectRepository projectObjectRepository;
    private final TenantRepository tenantRepository;
    private final ObjectRepository objectRepository;
    private final LinkRepository linkRepository;
    private final DashboardRepository dashboardRepository;
    private final OntologyService ontologyService;
    private final ChannelResolver channelResolver;
    private final LatestValueProjection latestValueProjection;

    /** Graph detail from the resolver, last-seen from the in-memory projection. */
    record DeviceHealthDetail(UUID siteId, UUID objectId, String objectName,
                              String objectTypeName, String objectTypeCategory,
                              String deviceId, java.time.Instant lastTime) {
    }

    // ─── DTOs ─────────────────────────────────────────────────────────────────

    public record ProjectDTO(
        UUID id,
        UUID tenantId,
        String name,
        String description,
        String status,
        int siteCount,
        Instant createdAt,
        Instant updatedAt
    ) {}

    public record ProjectDetailDTO(
        UUID id,
        UUID tenantId,
        String name,
        String description,
        String status,
        List<ProjectSiteDTO> sites,
        Instant createdAt,
        Instant updatedAt
    ) {}

    public record ProjectSiteDTO(
        UUID siteId,
        String siteName,
        Instant addedAt
    ) {}

    public record CreateProjectRequest(
        String name,
        String description,
        UUID tenantId
    ) {}

    public record UpdateProjectRequest(
        String name,
        String description,
        String status
    ) {}

    // ─── CRUD ─────────────────────────────────────────────────────────────────

    public List<ProjectDTO> listProjects(List<UUID> tenantIds) {
        List<Project> projects;
        if (tenantIds == null || tenantIds.isEmpty()) {
            projects = projectRepository.findAllByOrderByNameAsc();
        } else {
            projects = projectRepository.findByTenantIdInOrderByNameAsc(tenantIds);
        }
        return projects.stream().map(this::toDTO).collect(Collectors.toList());
    }

    public ProjectDetailDTO getProject(UUID projectId) {
        Project project = projectRepository.findById(projectId)
            .orElseThrow(() -> new ResourceNotFoundException("Project", projectId));

        List<ProjectObject> projectObjects = projectObjectRepository.findByProjectId(projectId);
        List<ProjectSiteDTO> siteDTOs = projectObjects.stream().map(po -> {
            String siteName = objectRepository.findById(po.getObjectId())
                .map(ObjectEntity::getDisplayName).orElse("Unknown");
            return new ProjectSiteDTO(po.getObjectId(), siteName, po.getAddedAt());
        }).collect(Collectors.toList());

        return new ProjectDetailDTO(
            project.getId(),
            project.getTenant().getId(),
            project.getName(),
            project.getDescription(),
            project.getStatus(),
            siteDTOs,
            project.getCreatedAt(),
            project.getUpdatedAt()
        );
    }

    @Transactional
    public ProjectDTO createProject(CreateProjectRequest request) {
        if (request.name() == null || request.name().isBlank()) {
            throw new ValidationException("Project name is required");
        }
        if (request.tenantId() == null) {
            throw new ValidationException("Tenant ID is required");
        }

        Tenant tenant = tenantRepository.findById(request.tenantId())
            .orElseThrow(() -> new ResourceNotFoundException("Tenant", request.tenantId()));

        Project project = new Project();
        project.setTenant(tenant);
        project.setName(request.name().trim());
        project.setDescription(request.description());
        project.setStatus("active");
        project.setCreatedAt(Instant.now());
        project.setUpdatedAt(Instant.now());

        Project saved = projectRepository.save(project);
        log.info("Created project: {} (id: {})", saved.getName(), saved.getId());

        try {
            Dashboard d = new Dashboard();
            d.setProjectId(saved.getId());
            d.setName("System Overview");
            d.setSortOrder(0);
            d.setLayout("{\"columns\":2,\"widgets\":[{\"id\":\"default-1\",\"type\":\"stat_card\",\"title\":\"Total Sites\",\"position\":{\"row\":0,\"col\":0,\"rowSpan\":1,\"colSpan\":1},\"config\":{\"metric\":\"total_sites\"}}]}");
            d.setCreatedAt(Instant.now());
            d.setUpdatedAt(Instant.now());
            dashboardRepository.save(d);
        } catch (Exception e) {
            log.warn("Failed to seed default dashboard for project {}: {}", saved.getId(), e.getMessage());
        }

        return toDTO(saved);
    }

    @Transactional
    public ProjectDTO updateProject(UUID projectId, UpdateProjectRequest request) {
        Project project = projectRepository.findById(projectId)
            .orElseThrow(() -> new ResourceNotFoundException("Project", projectId));

        if (request.name() != null && !request.name().isBlank()) {
            project.setName(request.name().trim());
        }
        if (request.description() != null) {
            project.setDescription(request.description());
        }
        if (request.status() != null) {
            if (!Set.of("active", "archived").contains(request.status())) {
                throw new ValidationException("Status must be 'active' or 'archived'");
            }
            project.setStatus(request.status());
        }
        project.setUpdatedAt(Instant.now());

        Project saved = projectRepository.save(project);
        log.info("Updated project: {} (id: {})", saved.getName(), saved.getId());
        return toDTO(saved);
    }

    @Transactional
    public void deleteProject(UUID projectId) {
        if (!projectRepository.existsById(projectId)) {
            throw new ResourceNotFoundException("Project", projectId);
        }
        projectRepository.deleteById(projectId);
        log.info("Deleted project: {}", projectId);
    }

    // ─── Settings ──────────────────────────────────────────────────────────────

    public String getProjectSettings(UUID projectId) {
        Project project = projectRepository.findById(projectId)
            .orElseThrow(() -> new ResourceNotFoundException("Project", projectId));
        return project.getSettings();
    }

    @Transactional
    public String updateProjectSettings(UUID projectId, String settings) {
        Project project = projectRepository.findById(projectId)
            .orElseThrow(() -> new ResourceNotFoundException("Project", projectId));
        project.setSettings(settings);
        project.setUpdatedAt(Instant.now());
        projectRepository.save(project);
        return project.getSettings();
    }

    // ─── Site management ──────────────────────────────────────────────────────

    @Transactional
    public void addSiteToProject(UUID projectId, UUID siteId) {
        if (!projectRepository.existsById(projectId)) {
            throw new ResourceNotFoundException("Project", projectId);
        }
        if (!objectRepository.existsById(siteId)) {
            throw new ResourceNotFoundException("Site", siteId);
        }
        if (projectObjectRepository.existsByProjectIdAndObjectId(projectId, siteId)) {
            return; // idempotent
        }

        ProjectObject po = new ProjectObject();
        po.setProjectId(projectId);
        po.setObjectId(siteId);
        po.setAddedAt(Instant.now());
        projectObjectRepository.save(po);
        log.info("Added site {} to project {}", siteId, projectId);
    }

    @Transactional
    public void removeSiteFromProject(UUID projectId, UUID siteId) {
        if (!projectObjectRepository.existsByProjectIdAndObjectId(projectId, siteId)) {
            throw new ResourceNotFoundException("ProjectSite", siteId);
        }
        projectObjectRepository.deleteByProjectIdAndObjectId(projectId, siteId);
        log.info("Removed site {} from project {}", siteId, projectId);
    }

    // ─── Graph aggregation ────────────────────────────────────────────────────

    public record ProjectGraphResult(
        List<ObjectEntity> objects,
        List<Link> links
    ) {}

    /**
     * Collect all object IDs within a project's scope: root sites + CONTAINS descendants + INSTALLED_AT assets.
     */
    public Set<UUID> collectProjectObjectIds(UUID projectId) {
        if (!projectRepository.existsById(projectId)) {
            throw new ResourceNotFoundException("Project", projectId);
        }
        Set<UUID> allObjectIds = new LinkedHashSet<>();
        List<UUID> siteIds = projectObjectRepository.findObjectIdsByProjectId(projectId);
        for (UUID siteId : siteIds) {
            allObjectIds.add(siteId);
            allObjectIds.addAll(collectContainedIds(siteId));
            allObjectIds.addAll(ontologyService.findSourceIds(siteId, OntologyService.INSTALLED_AT));
        }
        return allObjectIds;
    }

    /**
     * Get the root site IDs for a project (no recursive expansion).
     */
    public List<UUID> getProjectSiteIds(UUID projectId) {
        if (!projectRepository.existsById(projectId)) {
            throw new ResourceNotFoundException("Project", projectId);
        }
        return projectObjectRepository.findObjectIdsByProjectId(projectId);
    }

    public ProjectGraphResult getProjectGraph(UUID projectId) {
        Set<UUID> allObjectIds = collectProjectObjectIds(projectId);

        if (allObjectIds.isEmpty()) {
            return new ProjectGraphResult(List.of(), List.of());
        }

        List<ObjectEntity> objects = objectRepository.findAllWithTypeByIdIn(allObjectIds);
        List<Link> links = allObjectIds.size() <= 1000
            ? linkRepository.findAllWithinObjectIds(allObjectIds)
            : List.of();

        return new ProjectGraphResult(objects, links);
    }

    // ─── Project Health ────────────────────────────────────────────────────────

    /**
     * Compute device-level health for all buildings in a project.
     * Returns per-building device connectivity status using the same thresholds as FleetService.
     */
    public ProjectHealthDTO getProjectHealth(UUID projectId) {
        List<UUID> siteIds = getProjectSiteIds(projectId);

        if (siteIds.isEmpty()) {
            return new ProjectHealthDTO(List.of(), new ProjectHealthDTO.Totals(0, 0, 0, 0, 0));
        }

        // Load building entities for display names
        List<ObjectEntity> buildings = objectRepository.findAllById(siteIds);
        Map<UUID, String> buildingNames = new HashMap<>();
        for (ObjectEntity b : buildings) {
            buildingNames.put(b.getId(), b.getDisplayName());
        }

        // Fetch per-device last-seen data
        List<DeviceHealthDetail> deviceData =
            channelResolver.deviceDetailsBySites(siteIds).stream()
                .map(d -> new DeviceHealthDetail(d.siteId(), d.objectId(), d.objectName(),
                        d.objectTypeName(), d.objectTypeCategory(), d.deviceId(),
                        latestValueProjection.lastSeen(d.deviceId()).orElse(null)))
                .toList();

        // Group by site
        Map<UUID, List<DeviceHealthDetail>> bySite =
            deviceData.stream().collect(Collectors.groupingBy(DeviceHealthDetail::siteId));

        Instant now = Instant.now();
        List<ProjectHealthDTO.BuildingHealth> buildingHealths = new ArrayList<>();
        int totalDevices = 0, totalOnline = 0, totalStale = 0, totalOffline = 0;

        for (UUID siteId : siteIds) {
            String name = buildingNames.getOrDefault(siteId, "Unknown");
            List<DeviceHealthDetail> devices = bySite.getOrDefault(siteId, List.of());

            int online = 0, stale = 0, offline = 0, noData = 0;
            List<ProjectHealthDTO.DeviceHealth> deviceHealths = new ArrayList<>();

            for (DeviceHealthDetail d : devices) {
                String status;
                Long lastSeenEpoch = null;

                if (d.lastTime() == null) {
                    status = "no_data";
                    noData++;
                } else {
                    lastSeenEpoch = d.lastTime().getEpochSecond();
                    Duration age = Duration.between(d.lastTime(), now);
                    if (age.compareTo(FleetService.ONLINE_THRESHOLD) <= 0) {
                        status = "online";
                        online++;
                    } else if (age.compareTo(FleetService.OFFLINE_THRESHOLD) <= 0) {
                        status = "stale";
                        stale++;
                    } else {
                        status = "offline";
                        offline++;
                    }
                }

                deviceHealths.add(new ProjectHealthDTO.DeviceHealth(
                    d.objectId(), d.deviceId(), d.objectName(),
                    d.objectTypeName(), d.objectTypeCategory(),
                    status, lastSeenEpoch
                ));
            }

            // Sort: offline first, then stale, then online, then no_data
            deviceHealths.sort(Comparator.comparingInt(dh -> switch (dh.status()) {
                case "offline" -> 0;
                case "stale" -> 1;
                case "no_data" -> 2;
                case "online" -> 3;
                default -> 4;
            }));

            // Compute building-level status using FleetService logic
            String buildingStatus;
            if (devices.isEmpty()) {
                buildingStatus = "healthy"; // no devices = nothing wrong
            } else if (devices.stream().allMatch(d -> d.lastTime() == null)) {
                buildingStatus = "offline";
            } else if (offline > 0) {
                buildingStatus = "critical";
            } else if (stale > 0) {
                buildingStatus = "warning";
            } else {
                buildingStatus = "healthy";
            }

            buildingHealths.add(new ProjectHealthDTO.BuildingHealth(
                siteId, name, buildingStatus, deviceHealths,
                new ProjectHealthDTO.Summary(online, stale, offline, noData)
            ));

            totalDevices += devices.size();
            totalOnline += online;
            totalStale += stale;
            totalOffline += offline;
        }

        // Sort buildings: critical first, then warning, then healthy
        buildingHealths.sort(Comparator.comparingInt(bh -> switch (bh.status()) {
            case "critical" -> 0;
            case "warning" -> 1;
            case "offline" -> 2;
            case "healthy" -> 3;
            default -> 4;
        }));

        return new ProjectHealthDTO(
            buildingHealths,
            new ProjectHealthDTO.Totals(siteIds.size(), totalDevices, totalOnline, totalStale, totalOffline)
        );
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    private List<UUID> collectContainedIds(UUID rootId) {
        List<UUID> result = new ArrayList<>();
        List<ObjectEntity> direct = ontologyService.getOutboundNeighbors(rootId, OntologyService.CONTAINS);
        for (ObjectEntity child : direct) {
            result.add(child.getId());
            result.addAll(collectContainedIds(child.getId()));
        }
        return result;
    }

    private ProjectDTO toDTO(Project project) {
        int siteCount = projectObjectRepository.findByProjectId(project.getId()).size();
        return new ProjectDTO(
            project.getId(),
            project.getTenant().getId(),
            project.getName(),
            project.getDescription(),
            project.getStatus(),
            siteCount,
            project.getCreatedAt(),
            project.getUpdatedAt()
        );
    }
}
