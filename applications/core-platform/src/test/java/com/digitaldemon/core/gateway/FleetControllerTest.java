package com.digitaldemon.core.gateway;

import com.digitaldemon.core.fleet.FleetController;

import com.digitaldemon.core.fleet.FleetSiteHealthDTO;
import com.digitaldemon.core.fleet.FleetStatusDTO;
import com.digitaldemon.core.ontology.ObjectEntity;
import com.digitaldemon.core.ontology.ObjectType;
import com.digitaldemon.core.tenant.Tenant;
import com.digitaldemon.core.ontology.ObjectRepository;
import com.digitaldemon.core.user.AuthService;
import com.digitaldemon.core.fleet.FleetService;
import com.digitaldemon.core.ontology.OntologyService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.ResponseEntity;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
class FleetControllerTest {

    @Mock
    private FleetService fleetService;

    @Mock
    private AuthService authService;

    @Mock
    private ObjectRepository objectRepository;

    @InjectMocks
    private FleetController fleetController;

    // ── Helper builders ──────────────────────────────────────────────────

    private ObjectEntity buildSiteObject(UUID id, String name, Tenant tenant) {
        ObjectType objectType = new ObjectType();
        objectType.setId(UUID.randomUUID());
        objectType.setName("BUILDING");
        objectType.setDisplayName("Building");

        ObjectEntity obj = new ObjectEntity();
        obj.setId(id);
        obj.setDisplayName(name);
        obj.setObjectType(objectType);
        obj.setTenant(tenant);
        obj.setProperties("{}");
        return obj;
    }

    // ── Authorization tests ──────────────────────────────────────────────

    @Test
    void getFleetStatus_NotConsultant_Returns403() {
        given(authService.isConsultantOrAdmin()).willReturn(false);

        ResponseEntity<Map<String, Object>> response = fleetController.getFleetStatus();

        assertThat(response.getStatusCode().value()).isEqualTo(403);
        assertThat(response.getBody()).containsKey("message");
        verify(fleetService, never()).getFleetStatus(anyList());
    }

    @Test
    void getFleetStatus_Consultant_Returns200() {
        given(authService.isConsultantOrAdmin()).willReturn(true);
        given(authService.isSystemAdmin()).willReturn(false);
        given(authService.getAccessibleTenantIds()).willReturn(List.of(UUID.randomUUID()));

        UUID tenantId = UUID.randomUUID();
        Tenant tenant = new Tenant();
        tenant.setId(tenantId);
        tenant.setName("Test Tenant");

        UUID siteId = UUID.randomUUID();
        ObjectEntity site = buildSiteObject(siteId, "Test Site", tenant);

        given(objectRepository.findByTenantIdsWithTenantAndObjectTypeName(anyList(), org.mockito.ArgumentMatchers.eq(OntologyService.BUILDING)))
            .willReturn(List.of(site));

        FleetSiteHealthDTO healthDTO = new FleetSiteHealthDTO(
            siteId, "Test Site", "{}", tenantId, "Test Tenant",
            null, null, 5, 5, 0, 0,
            Instant.now(), "healthy"
        );
        FleetStatusDTO.FleetSummary summary = new FleetStatusDTO.FleetSummary(
            1, 5, 1, 1, 0, 0, 0
        );
        FleetStatusDTO fleetStatus = new FleetStatusDTO(List.of(healthDTO), summary);

        given(fleetService.getFleetStatus(anyList())).willReturn(fleetStatus);

        ResponseEntity<Map<String, Object>> response = fleetController.getFleetStatus();

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getBody()).containsKey("sites");
        assertThat(response.getBody()).containsKey("summary");
    }

    @Test
    void getFleetStatus_SystemAdmin_LoadsAllSites() {
        given(authService.isConsultantOrAdmin()).willReturn(true);
        given(authService.isSystemAdmin()).willReturn(true);
        given(objectRepository.findAllWithTenantByObjectTypeName(OntologyService.BUILDING)).willReturn(List.of());

        FleetStatusDTO emptyFleet = new FleetStatusDTO(List.of(),
            new FleetStatusDTO.FleetSummary(0, 0, 0, 0, 0, 0, 0));
        given(fleetService.getFleetStatus(anyList())).willReturn(emptyFleet);

        ResponseEntity<Map<String, Object>> response = fleetController.getFleetStatus();

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        verify(objectRepository).findAllWithTenantByObjectTypeName(OntologyService.BUILDING);
        verify(objectRepository, never()).findByTenantIdsWithTenantAndObjectTypeName(anyList(), org.mockito.ArgumentMatchers.any());
    }

    @Test
    void getFleetStatus_ConsultantNoTenants_ReturnsEmptyFleet() {
        given(authService.isConsultantOrAdmin()).willReturn(true);
        given(authService.isSystemAdmin()).willReturn(false);
        given(authService.getAccessibleTenantIds()).willReturn(List.of());

        FleetStatusDTO emptyFleet = new FleetStatusDTO(List.of(),
            new FleetStatusDTO.FleetSummary(0, 0, 0, 0, 0, 0, 0));
        given(fleetService.getFleetStatus(anyList())).willReturn(emptyFleet);

        ResponseEntity<Map<String, Object>> response = fleetController.getFleetStatus();

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        @SuppressWarnings("unchecked")
        Map<String, Object> summaryMap = (Map<String, Object>) response.getBody().get("summary");
        assertThat(summaryMap.get("totalSites")).isEqualTo(0);
    }

    // ── Response shape tests ─────────────────────────────────────────────

    @Test
    @SuppressWarnings("unchecked")
    void getFleetStatus_ResponseContainsHealthNested() {
        given(authService.isConsultantOrAdmin()).willReturn(true);
        given(authService.isSystemAdmin()).willReturn(true);

        UUID tenantId = UUID.randomUUID();
        UUID siteId = UUID.randomUUID();
        Instant lastSeen = Instant.now();

        Tenant tenant = new Tenant();
        tenant.setId(tenantId);
        tenant.setName("T");
        ObjectEntity site = buildSiteObject(siteId, "S", tenant);

        given(objectRepository.findAllWithTenantByObjectTypeName(OntologyService.BUILDING))
            .willReturn(List.of(site));

        FleetSiteHealthDTO dto = new FleetSiteHealthDTO(
            siteId, "S", "{}", tenantId, "T",
            48.1351, 11.582, 10, 8, 1, 1,
            lastSeen, "warning"
        );
        FleetStatusDTO fleetStatus = new FleetStatusDTO(
            List.of(dto),
            new FleetStatusDTO.FleetSummary(1, 10, 1, 0, 1, 0, 0)
        );
        given(fleetService.getFleetStatus(anyList())).willReturn(fleetStatus);

        ResponseEntity<Map<String, Object>> response = fleetController.getFleetStatus();

        List<Map<String, Object>> sites = (List<Map<String, Object>>) response.getBody().get("sites");
        assertThat(sites).hasSize(1);

        Map<String, Object> siteMap = sites.get(0);
        assertThat(siteMap.get("name")).isEqualTo("S");
        assertThat(siteMap.get("latitude")).isEqualTo(48.1351);
        assertThat(siteMap.get("longitude")).isEqualTo(11.582);
        assertThat(siteMap.get("tenantName")).isEqualTo("T");

        Map<String, Object> health = (Map<String, Object>) siteMap.get("health");
        assertThat(health.get("status")).isEqualTo("warning");
        assertThat(health.get("onlineAssets")).isEqualTo(8);
        assertThat(health.get("offlineAssets")).isEqualTo(1);
        assertThat(health.get("staleSensors")).isEqualTo(1);
        assertThat(health.get("lastDataReceived")).isEqualTo(lastSeen.getEpochSecond());
    }

    @Test
    void getFleetStatus_InternalError_Returns500() {
        given(authService.isConsultantOrAdmin()).willReturn(true);
        given(authService.isSystemAdmin()).willReturn(true);
        given(objectRepository.findAllWithTenantByObjectTypeName(OntologyService.BUILDING))
            .willThrow(new RuntimeException("DB error"));

        ResponseEntity<Map<String, Object>> response = fleetController.getFleetStatus();

        assertThat(response.getStatusCode().value()).isEqualTo(500);
        assertThat(response.getBody()).containsKey("message");
    }
}
