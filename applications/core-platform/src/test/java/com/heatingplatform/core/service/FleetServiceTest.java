package com.heatingplatform.core.service;

import com.heatingplatform.core.ontology.OntologyService;
import com.heatingplatform.core.fleet.FleetService;

import com.heatingplatform.core.fleet.FleetSiteHealthDTO;
import com.heatingplatform.core.fleet.FleetStatusDTO;
import com.heatingplatform.core.ontology.ObjectEntity;
import com.heatingplatform.core.ontology.ObjectType;
import com.heatingplatform.core.tenant.Tenant;
import com.heatingplatform.core.measurement.ChannelResolver;
import com.heatingplatform.core.measurement.LatestValueProjection;

import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.BDDMockito.given;

@ExtendWith(MockitoExtension.class)
class FleetServiceTest {

    @Mock
    private ChannelResolver channelResolver;

    @Mock
    private LatestValueProjection latestValueProjection;

    @Mock
    private OntologyService ontologyService;

    @InjectMocks
    private FleetService fleetService;

    // ── Helper builders ──────────────────────────────────────────────────

    private ObjectEntity buildSite(UUID id, String name, Tenant tenant) {
        ObjectType objectType = new ObjectType();
        objectType.setId(UUID.randomUUID());
        objectType.setName("BUILDING");
        objectType.setDisplayName("Building");

        ObjectEntity site = new ObjectEntity();
        site.setId(id);
        site.setDisplayName(name);
        site.setObjectType(objectType);
        site.setTenant(tenant);
        site.setProperties("{\"address\": {\"display\": \"" + name + " address\"}}");
        return site;
    }

    private Tenant buildTenant(UUID id, String name) {
        Tenant tenant = new Tenant();
        tenant.setId(id);
        tenant.setName(name);
        return tenant;
    }

    // ── computeSiteStatus tests ──────────────────────────────────────────

    @Test
    void computeSiteStatus_NoAssets_ReturnsHealthy() {
        String status = fleetService.computeSiteStatus(0, 0, 0, 0, null, Instant.now());
        assertThat(status).isEqualTo("healthy");
    }

    @Test
    void computeSiteStatus_AllOnline_ReturnsHealthy() {
        Instant now = Instant.now();
        String status = fleetService.computeSiteStatus(5, 5, 0, 0, now.minus(Duration.ofMinutes(10)), now);
        assertThat(status).isEqualTo("healthy");
    }

    @Test
    void computeSiteStatus_SomeStaleSensors_ReturnsWarning() {
        Instant now = Instant.now();
        String status = fleetService.computeSiteStatus(5, 3, 2, 0, now.minus(Duration.ofMinutes(10)), now);
        assertThat(status).isEqualTo("warning");
    }

    @Test
    void computeSiteStatus_SomeOfflineSensors_ReturnsCritical() {
        Instant now = Instant.now();
        String status = fleetService.computeSiteStatus(5, 3, 0, 2, now.minus(Duration.ofMinutes(10)), now);
        assertThat(status).isEqualTo("critical");
    }

    @Test
    void computeSiteStatus_OfflineTrumpsStaleSensors_ReturnsCritical() {
        Instant now = Instant.now();
        String status = fleetService.computeSiteStatus(5, 1, 2, 2, now.minus(Duration.ofMinutes(10)), now);
        assertThat(status).isEqualTo("critical");
    }

    @Test
    void computeSiteStatus_NoDataEver_ReturnsOffline() {
        String status = fleetService.computeSiteStatus(3, 0, 0, 0, null, Instant.now());
        assertThat(status).isEqualTo("offline");
    }

    @Test
    void computeSiteStatus_NoDataFor48Hours_ReturnsOffline() {
        Instant now = Instant.now();
        Instant lastData = now.minus(Duration.ofHours(49));
        String status = fleetService.computeSiteStatus(3, 0, 0, 3, lastData, now);
        assertThat(status).isEqualTo("offline");
    }

    @Test
    void computeSiteStatus_LastDataAt48HourBoundary_ReturnsCritical() {
        Instant now = Instant.now();
        // Exactly at 48h boundary — not yet exceeded
        Instant lastData = now.minus(Duration.ofHours(48));
        // All sensors offline (>24h), but last data at exactly 48h
        String status = fleetService.computeSiteStatus(2, 0, 0, 2, lastData, now);
        assertThat(status).isEqualTo("critical");
    }

    // ── getFleetStatus integration tests ─────────────────────────────────

    @Test
    void getFleetStatus_EmptyList_ReturnsEmptySummary() {
        FleetStatusDTO result = fleetService.getFleetStatus(List.of());

        assertThat(result.sites()).isEmpty();
        assertThat(result.summary().totalSites()).isZero();
        assertThat(result.summary().totalAssets()).isZero();
        assertThat(result.summary().totalTenants()).isZero();
    }

    @Test
    void getFleetStatus_AllHealthySites_ReturnsCorrectCounts() {
        UUID tenantId = UUID.randomUUID();
        Tenant tenant = buildTenant(tenantId, "Test Tenant");

        UUID siteId1 = UUID.randomUUID();
        UUID siteId2 = UUID.randomUUID();
        ObjectEntity site1 = buildSite(siteId1, "Site A", tenant);
        ObjectEntity site2 = buildSite(siteId2, "Site B", tenant);

        Instant recentTime = Instant.now().minus(Duration.ofMinutes(30));

        given(channelResolver.devicesBySites(List.of(siteId1, siteId2)))
            .willReturn(List.of(
                new ChannelResolver.DeviceSite(siteId1, "DEV-001"),
                new ChannelResolver.DeviceSite(siteId1, "DEV-002"),
                new ChannelResolver.DeviceSite(siteId2, "DEV-003")
            ));
        given(latestValueProjection.lastSeen("DEV-001")).willReturn(Optional.of(recentTime));
        given(latestValueProjection.lastSeen("DEV-002")).willReturn(Optional.of(recentTime));
        given(latestValueProjection.lastSeen("DEV-003")).willReturn(Optional.of(recentTime));
        given(ontologyService.countByTargetAndType(siteId1, OntologyService.INSTALLED_AT)).willReturn(2);
        given(ontologyService.countByTargetAndType(siteId2, OntologyService.INSTALLED_AT)).willReturn(1);

        FleetStatusDTO result = fleetService.getFleetStatus(List.of(site1, site2));

        assertThat(result.sites()).hasSize(2);
        assertThat(result.summary().totalSites()).isEqualTo(2);
        assertThat(result.summary().totalAssets()).isEqualTo(3);
        assertThat(result.summary().totalTenants()).isEqualTo(1);
        assertThat(result.summary().healthyCount()).isEqualTo(2);
        assertThat(result.summary().warningCount()).isZero();
        assertThat(result.summary().criticalCount()).isZero();
    }

    @Test
    void getFleetStatus_MixedHealthStatuses_SortsBySeverity() {
        UUID tenantId = UUID.randomUUID();
        Tenant tenant = buildTenant(tenantId, "Mixed Tenant");

        UUID healthySiteId = UUID.randomUUID();
        UUID warningSiteId = UUID.randomUUID();
        UUID criticalSiteId = UUID.randomUUID();
        ObjectEntity healthySite = buildSite(healthySiteId, "Healthy", tenant);
        ObjectEntity warningSite = buildSite(warningSiteId, "Warning", tenant);
        ObjectEntity criticalSite = buildSite(criticalSiteId, "Critical", tenant);

        Instant now = Instant.now();
        Instant recent = now.minus(Duration.ofMinutes(30));
        Instant stale = now.minus(Duration.ofHours(5));
        Instant offline = now.minus(Duration.ofHours(30));

        given(channelResolver.devicesBySites(List.of(healthySiteId, warningSiteId, criticalSiteId)))
            .willReturn(List.of(
                new ChannelResolver.DeviceSite(healthySiteId, "DEV-H1"),
                new ChannelResolver.DeviceSite(warningSiteId, "DEV-W1"),
                new ChannelResolver.DeviceSite(criticalSiteId, "DEV-C1")
            ));
        given(latestValueProjection.lastSeen("DEV-H1")).willReturn(Optional.of(recent));
        given(latestValueProjection.lastSeen("DEV-W1")).willReturn(Optional.of(stale));
        given(latestValueProjection.lastSeen("DEV-C1")).willReturn(Optional.of(offline));
        given(ontologyService.countByTargetAndType(healthySiteId, OntologyService.INSTALLED_AT)).willReturn(1);
        given(ontologyService.countByTargetAndType(warningSiteId, OntologyService.INSTALLED_AT)).willReturn(1);
        given(ontologyService.countByTargetAndType(criticalSiteId, OntologyService.INSTALLED_AT)).willReturn(1);

        FleetStatusDTO result = fleetService.getFleetStatus(List.of(healthySite, warningSite, criticalSite));

        // Should be sorted: critical, warning, healthy
        assertThat(result.sites().get(0).status()).isEqualTo("critical");
        assertThat(result.sites().get(1).status()).isEqualTo("warning");
        assertThat(result.sites().get(2).status()).isEqualTo("healthy");

        assertThat(result.summary().healthyCount()).isEqualTo(1);
        assertThat(result.summary().warningCount()).isEqualTo(1);
        assertThat(result.summary().criticalCount()).isEqualTo(1);
    }

    @Test
    void getFleetStatus_AssetsWithNoMeasurements_CountedAsOffline() {
        UUID tenantId = UUID.randomUUID();
        Tenant tenant = buildTenant(tenantId, "Tenant");

        UUID siteId = UUID.randomUUID();
        ObjectEntity site = buildSite(siteId, "New Site", tenant);

        // 3 assets but no measurement data at all
        given(channelResolver.devicesBySites(List.of(siteId)))
            .willReturn(List.of(
                new ChannelResolver.DeviceSite(siteId, "DEV-1"),
                new ChannelResolver.DeviceSite(siteId, "DEV-2")
            ));
        given(latestValueProjection.lastSeen("DEV-1")).willReturn(Optional.empty());
        given(latestValueProjection.lastSeen("DEV-2")).willReturn(Optional.empty());
        given(ontologyService.countByTargetAndType(siteId, OntologyService.INSTALLED_AT)).willReturn(3);

        FleetStatusDTO result = fleetService.getFleetStatus(List.of(site));

        FleetSiteHealthDTO siteHealth = result.sites().get(0);
        assertThat(siteHealth.status()).isEqualTo("offline");
        assertThat(siteHealth.onlineAssets()).isZero();
        // 2 from null lastTime + 1 from asset count difference
        assertThat(siteHealth.offlineAssets()).isEqualTo(3);
    }

    @Test
    void getFleetStatus_MultipleTenants_CountsDistinctTenants() {
        UUID tenantId1 = UUID.randomUUID();
        UUID tenantId2 = UUID.randomUUID();
        Tenant tenant1 = buildTenant(tenantId1, "Tenant A");
        Tenant tenant2 = buildTenant(tenantId2, "Tenant B");

        UUID siteId1 = UUID.randomUUID();
        UUID siteId2 = UUID.randomUUID();
        UUID siteId3 = UUID.randomUUID();
        ObjectEntity site1 = buildSite(siteId1, "S1", tenant1);
        ObjectEntity site2 = buildSite(siteId2, "S2", tenant1);
        ObjectEntity site3 = buildSite(siteId3, "S3", tenant2);

        given(channelResolver.devicesBySites(List.of(siteId1, siteId2, siteId3)))
            .willReturn(List.of());
        given(ontologyService.countByTargetAndType(siteId1, OntologyService.INSTALLED_AT)).willReturn(0);
        given(ontologyService.countByTargetAndType(siteId2, OntologyService.INSTALLED_AT)).willReturn(0);
        given(ontologyService.countByTargetAndType(siteId3, OntologyService.INSTALLED_AT)).willReturn(0);

        FleetStatusDTO result = fleetService.getFleetStatus(List.of(site1, site2, site3));

        assertThat(result.summary().totalTenants()).isEqualTo(2);
        assertThat(result.summary().totalSites()).isEqualTo(3);
    }

    @Test
    void getFleetStatus_SiteWithNoAssets_IsHealthy() {
        UUID tenantId = UUID.randomUUID();
        Tenant tenant = buildTenant(tenantId, "Tenant");

        UUID siteId = UUID.randomUUID();
        ObjectEntity site = buildSite(siteId, "Empty Site", tenant);

        given(channelResolver.devicesBySites(List.of(siteId)))
            .willReturn(List.of());
        given(ontologyService.countByTargetAndType(siteId, OntologyService.INSTALLED_AT)).willReturn(0);

        FleetStatusDTO result = fleetService.getFleetStatus(List.of(site));

        assertThat(result.sites().get(0).status()).isEqualTo("healthy");
        assertThat(result.summary().healthyCount()).isEqualTo(1);
    }

    // ── extractJsonDouble utility tests ──────────────────────────────────

    @Test
    void extractJsonDouble_ValidJson_ExtractsValue() {
        String json = "{\"latitude\": 48.1351, \"longitude\": 11.582}";
        assertThat(FleetService.extractJsonDouble(json, "latitude")).isEqualTo(48.1351);
        assertThat(FleetService.extractJsonDouble(json, "longitude")).isEqualTo(11.582);
    }

    @Test
    void extractJsonDouble_NegativeValue_ExtractsCorrectly() {
        String json = "{\"latitude\": -33.8688, \"longitude\": 151.2093}";
        assertThat(FleetService.extractJsonDouble(json, "latitude")).isEqualTo(-33.8688);
    }

    @Test
    void extractJsonDouble_MissingKey_ReturnsNull() {
        String json = "{\"name\": \"test\"}";
        assertThat(FleetService.extractJsonDouble(json, "latitude")).isNull();
    }

    @Test
    void extractJsonDouble_NullJson_ReturnsNull() {
        assertThat(FleetService.extractJsonDouble(null, "latitude")).isNull();
    }

    @Test
    void extractJsonDouble_EmptyJson_ReturnsNull() {
        assertThat(FleetService.extractJsonDouble("{}", "latitude")).isNull();
    }
}
