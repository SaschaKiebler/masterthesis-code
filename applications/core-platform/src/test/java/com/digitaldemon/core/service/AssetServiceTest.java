package com.digitaldemon.core.service;

import com.digitaldemon.core.ontology.OntologyService;
import com.digitaldemon.core.asset.AssetService;

import com.digitaldemon.core.asset.AssetDTO;
import com.digitaldemon.core.measurement.MeasurementDTO;
import com.digitaldemon.core.measurement.MeasurementStatisticsDTO;
import com.digitaldemon.core.ontology.ObjectEntity;
import com.digitaldemon.core.ontology.ObjectType;
import com.digitaldemon.core.common.exception.DuplicateResourceException;
import com.digitaldemon.core.common.exception.ResourceNotFoundException;
import com.digitaldemon.core.common.exception.ValidationException;
import com.digitaldemon.core.measurement.MeasurementRepository;
import com.digitaldemon.core.metricpoint.MetricPointRepository;
import com.digitaldemon.core.ontology.ObjectRepository;
import com.digitaldemon.core.device.PhysicalDeviceRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
class AssetServiceTest {

    @Mock
    private ObjectRepository objectRepository;

    @Mock
    private MeasurementRepository measurementRepository;

    @Mock
    private OntologyService ontologyService;

    @Mock
    private PhysicalDeviceRepository physicalDeviceRepository;

    @Mock
    private MetricPointRepository metricPointRepository;

    @InjectMocks
    private AssetService assetService;

    @Test
    void getAsset_ShouldMapEntityToDTO() {
        UUID id = UUID.randomUUID();
        ObjectEntity obj = new ObjectEntity();
        obj.setId(id);
        obj.setDisplayName("Test Asset");
        obj.setProperties("{}");

        given(objectRepository.findById(id)).willReturn(Optional.of(obj));
        given(ontologyService.resolveTargetId(id, OntologyService.INSTALLED_AT)).willReturn(null);
        given(ontologyService.resolveTargetId(id, OntologyService.INSTALLED_IN)).willReturn(null);

        Optional<AssetDTO> result = assetService.getAssetById(id);

        assertThat(result).isPresent();
        assertThat(result.get().id()).isEqualTo(id);
        assertThat(result.get().name()).isEqualTo("Test Asset");
    }

    @Test
    void getAssetById_WhenNotExists_ReturnsEmpty() {
        UUID id = UUID.randomUUID();
        given(objectRepository.findById(id)).willReturn(Optional.empty());

        Optional<AssetDTO> result = assetService.getAssetById(id);

        assertThat(result).isEmpty();
    }

    @Test
    void registerAssets_Success() {
        UUID siteId = UUID.randomUUID();
        UUID assetId = UUID.randomUUID();

        ObjectEntity site = new ObjectEntity();
        site.setId(siteId);

        ObjectEntity savedAsset = new ObjectEntity();
        savedAsset.setId(assetId);
        savedAsset.setDisplayName("Temperature Sensor");
        savedAsset.setProperties("{}");

        given(objectRepository.findById(siteId)).willReturn(Optional.of(site));
        given(physicalDeviceRepository.existsByDeviceId("DEV001")).willReturn(false);
        given(ontologyService.registerObject(any(UUID.class), any(String.class), any(), eq("Temperature Sensor"), any(String.class)))
            .willReturn(savedAsset);
        given(ontologyService.resolveTargetId(assetId, OntologyService.INSTALLED_AT)).willReturn(siteId);
        given(ontologyService.resolveTargetId(assetId, OntologyService.INSTALLED_IN)).willReturn(null);

        List<AssetService.DeviceRegistrationRequest> devices = List.of(
            new AssetService.DeviceRegistrationRequest(
                "DEV001", "lora", "SENSOR", "Temperature Sensor", "Dragino LHT65", "{}", null, null
            )
        );

        List<AssetDTO> result = assetService.registerAssets(siteId, devices);

        assertThat(result).hasSize(1);
        assertThat(result.get(0).name()).isEqualTo("Temperature Sensor");
        verify(ontologyService).registerObject(any(UUID.class), any(String.class), any(), eq("Temperature Sensor"), any(String.class));
    }

    @Test
    void registerAssets_MultipleDevices() {
        UUID siteId = UUID.randomUUID();

        ObjectEntity site = new ObjectEntity();
        site.setId(siteId);

        given(objectRepository.findById(siteId)).willReturn(Optional.of(site));
        given(physicalDeviceRepository.existsByDeviceId(any())).willReturn(false);
        given(ontologyService.registerObject(any(UUID.class), any(String.class), any(), any(String.class), any(String.class)))
            .willAnswer(inv -> {
                ObjectEntity obj = new ObjectEntity();
                obj.setId(UUID.randomUUID());
                obj.setDisplayName(inv.getArgument(3));
                obj.setProperties("{}");
                return obj;
            });
        given(ontologyService.resolveTargetId(any(UUID.class), eq(OntologyService.INSTALLED_AT))).willReturn(siteId);
        given(ontologyService.resolveTargetId(any(UUID.class), eq(OntologyService.INSTALLED_IN))).willReturn(null);

        List<AssetService.DeviceRegistrationRequest> devices = List.of(
            new AssetService.DeviceRegistrationRequest("DEV001", "lora", "SENSOR", "Sensor 1", null, null, null, null),
            new AssetService.DeviceRegistrationRequest("DEV002", "wmbus", "SENSOR", "Sensor 2", null, null, null, null)
        );

        List<AssetDTO> result = assetService.registerAssets(siteId, devices);

        assertThat(result).hasSize(2);
    }

    @Test
    void registerAssets_SiteNotFound_ThrowsNotFound() {
        UUID siteId = UUID.randomUUID();
        given(objectRepository.findById(siteId)).willReturn(Optional.empty());

        List<AssetService.DeviceRegistrationRequest> devices = List.of(
            new AssetService.DeviceRegistrationRequest("DEV001", "lora", "SENSOR", "Sensor", null, null, null, null)
        );

        assertThatThrownBy(() -> assetService.registerAssets(siteId, devices))
            .isInstanceOf(ResourceNotFoundException.class)
            .hasMessageContaining("Site not found");

        verify(ontologyService, never()).registerObject(any(), any(), any(), any(), any());
    }

    @Test
    void registerAssets_EmptyDeviceList_ThrowsValidation() {
        UUID siteId = UUID.randomUUID();
        ObjectEntity site = new ObjectEntity();
        site.setId(siteId);
        given(objectRepository.findById(siteId)).willReturn(Optional.of(site));

        assertThatThrownBy(() -> assetService.registerAssets(siteId, List.of()))
            .isInstanceOf(ValidationException.class)
            .hasMessageContaining("At least one device");

        verify(ontologyService, never()).registerObject(any(), any(), any(), any(), any());
    }

    @Test
    void registerAssets_DuplicateDeviceId_ThrowsDuplicate() {
        UUID siteId = UUID.randomUUID();
        ObjectEntity site = new ObjectEntity();
        site.setId(siteId);

        given(objectRepository.findById(siteId)).willReturn(Optional.of(site));
        given(physicalDeviceRepository.existsByDeviceId("EXISTING")).willReturn(true);

        List<AssetService.DeviceRegistrationRequest> devices = List.of(
            new AssetService.DeviceRegistrationRequest("EXISTING", "lora", "SENSOR", "Sensor", null, null, null, null)
        );

        assertThatThrownBy(() -> assetService.registerAssets(siteId, devices))
            .isInstanceOf(DuplicateResourceException.class)
            .hasMessageContaining("Device already registered");

        verify(ontologyService, never()).registerObject(any(), any(), any(), any(), any());
    }

    @Test
    void registerAssets_EmptyDeviceId_ThrowsValidation() {
        UUID siteId = UUID.randomUUID();
        ObjectEntity site = new ObjectEntity();
        site.setId(siteId);
        given(objectRepository.findById(siteId)).willReturn(Optional.of(site));

        List<AssetService.DeviceRegistrationRequest> devices = List.of(
            new AssetService.DeviceRegistrationRequest("", "lora", "SENSOR", "Sensor", null, null, null, null)
        );

        assertThatThrownBy(() -> assetService.registerAssets(siteId, devices))
            .isInstanceOf(ValidationException.class)
            .hasMessageContaining("Device ID must not be empty");

        verify(ontologyService, never()).registerObject(any(), any(), any(), any(), any());
    }

    @Test
    void registerAssets_EmptyType_ThrowsValidation() {
        UUID siteId = UUID.randomUUID();
        ObjectEntity site = new ObjectEntity();
        site.setId(siteId);
        given(objectRepository.findById(siteId)).willReturn(Optional.of(site));

        List<AssetService.DeviceRegistrationRequest> devices = List.of(
            new AssetService.DeviceRegistrationRequest("DEV001", "lora", "", "Sensor", null, null, null, null)
        );

        assertThatThrownBy(() -> assetService.registerAssets(siteId, devices))
            .isInstanceOf(ValidationException.class)
            .hasMessageContaining("Device type must not be empty");
    }

    // --- Site-Level Measurement Tests ---

    @Test
    void getSiteMeasurements_AutoBucket_24h() {
        UUID siteId = UUID.randomUUID();
        ObjectEntity site = new ObjectEntity();
        site.setId(siteId);
        given(objectRepository.findById(siteId)).willReturn(Optional.of(site));

        Instant now = Instant.now();
        Instant yesterday = now.minus(24, ChronoUnit.HOURS);

        List<MeasurementDTO> mockData = List.of(
            new MeasurementDTO(now.minus(1, ChronoUnit.HOURS), "dev1", 1, "flow_temp", 45.2),
            new MeasurementDTO(now.minus(1, ChronoUnit.HOURS), "dev1", 2, "return_temp", 32.1)
        );

        // 24h span -> auto bucket = 5 min
        given(measurementRepository.getSiteMeasurements(eq(siteId), any(), any(), eq(5)))
            .willReturn(mockData);

        AssetService.SiteMeasurementsResult result = assetService.getSiteMeasurements(
            siteId, yesterday, now, null);

        assertThat(result.bucketMinutes()).isEqualTo(5);
        assertThat(result.measurements()).hasSize(2);
        verify(measurementRepository).getSiteMeasurements(eq(siteId), any(), any(), eq(5));
    }

    @Test
    void getSiteMeasurements_ExplicitBucketOverride() {
        UUID siteId = UUID.randomUUID();
        ObjectEntity site = new ObjectEntity();
        site.setId(siteId);
        given(objectRepository.findById(siteId)).willReturn(Optional.of(site));

        Instant now = Instant.now();
        Instant yesterday = now.minus(24, ChronoUnit.HOURS);

        given(measurementRepository.getSiteMeasurements(eq(siteId), any(), any(), eq(15)))
            .willReturn(List.of());

        AssetService.SiteMeasurementsResult result = assetService.getSiteMeasurements(
            siteId, yesterday, now, 15);

        assertThat(result.bucketMinutes()).isEqualTo(15);
        verify(measurementRepository).getSiteMeasurements(eq(siteId), any(), any(), eq(15));
    }

    @Test
    void getSiteMeasurements_DefaultsTo24hWhenNoTimeRange() {
        UUID siteId = UUID.randomUUID();
        ObjectEntity site = new ObjectEntity();
        site.setId(siteId);
        given(objectRepository.findById(siteId)).willReturn(Optional.of(site));

        given(measurementRepository.getSiteMeasurements(eq(siteId), any(), any(), eq(5)))
            .willReturn(List.of());

        AssetService.SiteMeasurementsResult result = assetService.getSiteMeasurements(
            siteId, null, null, null);

        // Auto bucket for 24h range = 5 min
        assertThat(result.bucketMinutes()).isEqualTo(5);
    }

    @Test
    void getSiteMeasurements_SiteNotFound_Throws() {
        UUID siteId = UUID.randomUUID();
        given(objectRepository.findById(siteId)).willReturn(Optional.empty());

        assertThatThrownBy(() -> assetService.getSiteMeasurements(siteId, null, null, null))
            .isInstanceOf(ResourceNotFoundException.class)
            .hasMessageContaining("Site not found");
    }

    @Test
    void getSiteStatistics_Success() {
        UUID siteId = UUID.randomUUID();
        ObjectEntity site = new ObjectEntity();
        site.setId(siteId);
        given(objectRepository.findById(siteId)).willReturn(Optional.of(site));

        Instant now = Instant.now();
        Instant yesterday = now.minus(24, ChronoUnit.HOURS);

        List<MeasurementStatisticsDTO> mockStats = List.of(
            new MeasurementStatisticsDTO("dev1", 1, "flow_temp", 35.0, 72.0, 48.7, 8.2, 1440),
            new MeasurementStatisticsDTO("dev1", 2, "return_temp", 28.0, 58.0, 35.2, 6.1, 1440)
        );

        given(measurementRepository.getSiteStatistics(eq(siteId), any(), any()))
            .willReturn(mockStats);

        List<MeasurementStatisticsDTO> result = assetService.getSiteStatistics(siteId, yesterday, now);

        assertThat(result).hasSize(2);
        assertThat(result.get(0).metricName()).isEqualTo("flow_temp");
        assertThat(result.get(0).min()).isEqualTo(35.0);
        assertThat(result.get(0).max()).isEqualTo(72.0);
        assertThat(result.get(1).metricName()).isEqualTo("return_temp");
    }

    @Test
    void getSiteStatistics_SiteNotFound_Throws() {
        UUID siteId = UUID.randomUUID();
        given(objectRepository.findById(siteId)).willReturn(Optional.empty());

        assertThatThrownBy(() -> assetService.getSiteStatistics(siteId, null, null))
            .isInstanceOf(ResourceNotFoundException.class)
            .hasMessageContaining("Site not found");
    }

    // --- Update Asset Tests ---

    @Test
    void updateAsset_NameOnly_Success() {
        UUID assetId = UUID.randomUUID();
        ObjectEntity existing = new ObjectEntity();
        existing.setId(assetId);
        existing.setDisplayName("Old Name");
        existing.setProperties("{}");

        given(objectRepository.findById(assetId)).willReturn(Optional.of(existing));
        given(objectRepository.save(any(ObjectEntity.class))).willAnswer(invocation -> invocation.getArgument(0));
        given(ontologyService.resolveTargetId(assetId, OntologyService.INSTALLED_AT)).willReturn(null);
        given(ontologyService.resolveTargetId(assetId, OntologyService.INSTALLED_IN)).willReturn(null);

        AssetDTO result = assetService.updateAsset(assetId, "New Name", null);

        assertThat(result.name()).isEqualTo("New Name");
        verify(objectRepository).save(any(ObjectEntity.class));
    }

    @Test
    void updateAsset_TypeOnly_Success() {
        // type is now managed via the ontology object type — updateAsset accepts it silently
        UUID assetId = UUID.randomUUID();
        ObjectEntity existing = new ObjectEntity();
        existing.setId(assetId);
        existing.setDisplayName("My Asset");
        existing.setProperties("{}");

        given(objectRepository.findById(assetId)).willReturn(Optional.of(existing));
        given(objectRepository.save(any(ObjectEntity.class))).willAnswer(invocation -> invocation.getArgument(0));
        given(ontologyService.resolveTargetId(assetId, OntologyService.INSTALLED_AT)).willReturn(null);
        given(ontologyService.resolveTargetId(assetId, OntologyService.INSTALLED_IN)).willReturn(null);

        AssetDTO result = assetService.updateAsset(assetId, null, "ENERGY_METER");

        assertThat(result.name()).isEqualTo("My Asset");
    }

    @Test
    void updateAsset_BothFields_Success() {
        UUID assetId = UUID.randomUUID();
        ObjectEntity existing = new ObjectEntity();
        existing.setId(assetId);
        existing.setDisplayName("Old Name");
        existing.setProperties("{}");

        given(objectRepository.findById(assetId)).willReturn(Optional.of(existing));
        given(objectRepository.save(any(ObjectEntity.class))).willAnswer(invocation -> invocation.getArgument(0));
        given(ontologyService.resolveTargetId(assetId, OntologyService.INSTALLED_AT)).willReturn(null);
        given(ontologyService.resolveTargetId(assetId, OntologyService.INSTALLED_IN)).willReturn(null);

        AssetDTO result = assetService.updateAsset(assetId, "New Name", "ENERGY_METER");

        assertThat(result.name()).isEqualTo("New Name");
    }

    @Test
    void updateAsset_TrimsWhitespace() {
        UUID assetId = UUID.randomUUID();
        ObjectEntity existing = new ObjectEntity();
        existing.setId(assetId);
        existing.setDisplayName("Old");
        existing.setProperties("{}");

        given(objectRepository.findById(assetId)).willReturn(Optional.of(existing));
        given(objectRepository.save(any(ObjectEntity.class))).willAnswer(invocation -> invocation.getArgument(0));
        given(ontologyService.resolveTargetId(assetId, OntologyService.INSTALLED_AT)).willReturn(null);
        given(ontologyService.resolveTargetId(assetId, OntologyService.INSTALLED_IN)).willReturn(null);

        AssetDTO result = assetService.updateAsset(assetId, "  New Name  ", null);

        assertThat(result.name()).isEqualTo("New Name");
    }

    @Test
    void updateAsset_NoFieldsProvided_ThrowsValidation() {
        UUID assetId = UUID.randomUUID();
        ObjectEntity existing = new ObjectEntity();
        existing.setId(assetId);
        existing.setProperties("{}");

        given(objectRepository.findById(assetId)).willReturn(Optional.of(existing));

        assertThatThrownBy(() -> assetService.updateAsset(assetId, null, null))
            .isInstanceOf(ValidationException.class)
            .hasMessageContaining("At least one field");

        verify(objectRepository, never()).save(any());
    }

    @Test
    void updateAsset_BlankName_ThrowsValidation() {
        UUID assetId = UUID.randomUUID();
        ObjectEntity existing = new ObjectEntity();
        existing.setId(assetId);
        existing.setProperties("{}");

        given(objectRepository.findById(assetId)).willReturn(Optional.of(existing));

        assertThatThrownBy(() -> assetService.updateAsset(assetId, "  ", null))
            .isInstanceOf(ValidationException.class)
            .hasMessageContaining("At least one field");

        verify(objectRepository, never()).save(any());
    }

    @Test
    void updateAsset_NotFound_ThrowsNotFound() {
        UUID assetId = UUID.randomUUID();
        given(objectRepository.findById(assetId)).willReturn(Optional.empty());

        assertThatThrownBy(() -> assetService.updateAsset(assetId, "Name", null))
            .isInstanceOf(ResourceNotFoundException.class);

        verify(objectRepository, never()).save(any());
    }

    // --- Relocate Asset Tests ---

    @Test
    void relocateAsset_CrossSiteMove_Success() {
        UUID assetId = UUID.randomUUID();
        UUID oldSiteId = UUID.randomUUID();
        UUID newSiteId = UUID.randomUUID();

        ObjectEntity asset = new ObjectEntity();
        asset.setId(assetId);
        asset.setDisplayName("Temp Sensor");
        asset.setProperties("{}");

        ObjectEntity newSite = new ObjectEntity();
        newSite.setId(newSiteId);

        given(objectRepository.findById(assetId)).willReturn(Optional.of(asset));
        given(objectRepository.findById(newSiteId)).willReturn(Optional.of(newSite));
        given(ontologyService.resolveTargetId(assetId, OntologyService.INSTALLED_AT)).willReturn(oldSiteId);
        given(objectRepository.save(any(ObjectEntity.class))).willAnswer(inv -> inv.getArgument(0));
        given(ontologyService.resolveTargetId(assetId, OntologyService.INSTALLED_IN)).willReturn(null);

        AssetDTO result = assetService.relocateAsset(assetId, newSiteId, null);

        verify(ontologyService).deleteOutboundLinksOfType(assetId, OntologyService.INSTALLED_AT);
        verify(ontologyService).upsertLink(assetId, newSiteId, OntologyService.INSTALLED_AT);
        verify(objectRepository).save(any(ObjectEntity.class));
    }

    @Test
    void relocateAsset_CrossSiteMoveWithTargetSpace_Success() {
        UUID assetId = UUID.randomUUID();
        UUID oldSiteId = UUID.randomUUID();
        UUID newSiteId = UUID.randomUUID();
        UUID targetSpaceId = UUID.randomUUID();

        ObjectEntity asset = new ObjectEntity();
        asset.setId(assetId);
        asset.setDisplayName("Temp Sensor");
        asset.setProperties("{}");

        ObjectEntity newSite = new ObjectEntity();
        newSite.setId(newSiteId);

        given(objectRepository.findById(assetId)).willReturn(Optional.of(asset));
        given(objectRepository.findById(newSiteId)).willReturn(Optional.of(newSite));
        given(objectRepository.existsById(targetSpaceId)).willReturn(true);
        given(ontologyService.resolveTargetId(assetId, OntologyService.INSTALLED_AT)).willReturn(oldSiteId);
        given(objectRepository.save(any(ObjectEntity.class))).willAnswer(inv -> inv.getArgument(0));
        given(ontologyService.resolveTargetId(assetId, OntologyService.INSTALLED_IN)).willReturn(targetSpaceId);

        assetService.relocateAsset(assetId, newSiteId, targetSpaceId);

        verify(ontologyService).upsertLink(assetId, newSiteId, OntologyService.INSTALLED_AT);
        verify(ontologyService).upsertLink(assetId, targetSpaceId, OntologyService.INSTALLED_IN);
    }

    @Test
    void relocateAsset_SameSiteDifferentSpace_Success() {
        UUID assetId = UUID.randomUUID();
        UUID siteId = UUID.randomUUID();
        UUID newSpaceId = UUID.randomUUID();

        ObjectEntity asset = new ObjectEntity();
        asset.setId(assetId);
        asset.setDisplayName("Temp Sensor");
        asset.setProperties("{}");

        ObjectEntity site = new ObjectEntity();
        site.setId(siteId);

        given(objectRepository.findById(assetId)).willReturn(Optional.of(asset));
        given(objectRepository.findById(siteId)).willReturn(Optional.of(site));
        given(objectRepository.existsById(newSpaceId)).willReturn(true);
        given(ontologyService.resolveTargetId(assetId, OntologyService.INSTALLED_AT)).willReturn(siteId);
        given(objectRepository.save(any(ObjectEntity.class))).willAnswer(inv -> inv.getArgument(0));
        given(ontologyService.resolveTargetId(assetId, OntologyService.INSTALLED_IN)).willReturn(newSpaceId);

        assetService.relocateAsset(assetId, siteId, newSpaceId);

        verify(ontologyService).upsertLink(assetId, newSpaceId, OntologyService.INSTALLED_IN);
    }

    @Test
    void relocateAsset_SameSiteNoSpace_PreservesExistingSpace() {
        UUID assetId = UUID.randomUUID();
        UUID siteId = UUID.randomUUID();

        ObjectEntity asset = new ObjectEntity();
        asset.setId(assetId);
        asset.setDisplayName("Temp Sensor");
        asset.setProperties("{}");

        ObjectEntity site = new ObjectEntity();
        site.setId(siteId);

        given(objectRepository.findById(assetId)).willReturn(Optional.of(asset));
        given(objectRepository.findById(siteId)).willReturn(Optional.of(site));
        given(ontologyService.resolveTargetId(assetId, OntologyService.INSTALLED_AT)).willReturn(siteId);
        given(objectRepository.save(any(ObjectEntity.class))).willAnswer(inv -> inv.getArgument(0));
        given(ontologyService.resolveTargetId(assetId, OntologyService.INSTALLED_IN)).willReturn(null);

        assetService.relocateAsset(assetId, siteId, null);

        // Same site, no targetSpaceId -> existing INSTALLED_IN links are not touched
        verify(ontologyService, never()).deleteOutboundLinksOfType(assetId, OntologyService.INSTALLED_IN);
    }

    @Test
    void relocateAsset_AssetNotFound_ThrowsNotFound() {
        UUID assetId = UUID.randomUUID();
        UUID targetSiteId = UUID.randomUUID();
        given(objectRepository.findById(assetId)).willReturn(Optional.empty());

        assertThatThrownBy(() -> assetService.relocateAsset(assetId, targetSiteId, null))
            .isInstanceOf(ResourceNotFoundException.class)
            .hasMessageContaining("Asset not found");

        verify(objectRepository, never()).save(any());
    }

    @Test
    void relocateAsset_TargetSiteNotFound_ThrowsNotFound() {
        UUID assetId = UUID.randomUUID();
        UUID targetSiteId = UUID.randomUUID();

        ObjectEntity asset = new ObjectEntity();
        asset.setId(assetId);
        asset.setProperties("{}");

        given(objectRepository.findById(assetId)).willReturn(Optional.of(asset));
        given(objectRepository.findById(targetSiteId)).willReturn(Optional.empty());

        assertThatThrownBy(() -> assetService.relocateAsset(assetId, targetSiteId, null))
            .isInstanceOf(ResourceNotFoundException.class)
            .hasMessageContaining("Target site not found");

        verify(objectRepository, never()).save(any());
    }

    @Test
    void relocateAsset_TargetSpaceNotFound_ThrowsNotFound() {
        UUID assetId = UUID.randomUUID();
        UUID targetSiteId = UUID.randomUUID();
        UUID targetSpaceId = UUID.randomUUID();

        ObjectEntity asset = new ObjectEntity();
        asset.setId(assetId);
        asset.setProperties("{}");

        ObjectEntity site = new ObjectEntity();
        site.setId(targetSiteId);

        given(objectRepository.findById(assetId)).willReturn(Optional.of(asset));
        given(objectRepository.findById(targetSiteId)).willReturn(Optional.of(site));
        given(objectRepository.existsById(targetSpaceId)).willReturn(false);

        assertThatThrownBy(() -> assetService.relocateAsset(assetId, targetSiteId, targetSpaceId))
            .isInstanceOf(ResourceNotFoundException.class)
            .hasMessageContaining("Target space not found");

        verify(objectRepository, never()).save(any());
    }

    @Test
    void relocateAsset_TargetSpaceWrongSite_ThrowsValidation() {
        UUID assetId = UUID.randomUUID();
        UUID targetSiteId = UUID.randomUUID();
        UUID targetSpaceId = UUID.randomUUID();
        UUID otherSiteId = UUID.randomUUID();

        ObjectEntity asset = new ObjectEntity();
        asset.setId(assetId);
        asset.setProperties("{}");

        ObjectEntity targetSite = new ObjectEntity();
        targetSite.setId(targetSiteId);

        given(objectRepository.findById(assetId)).willReturn(Optional.of(asset));
        given(objectRepository.findById(targetSiteId)).willReturn(Optional.of(targetSite));
        given(objectRepository.existsById(targetSpaceId)).willReturn(true);
        // resolveSpaceSiteId returns otherSiteId (space belongs to a different site)
        given(ontologyService.resolveSourceId(targetSpaceId, OntologyService.CONTAINS)).willReturn(otherSiteId);
        given(ontologyService.getObject(otherSiteId)).willReturn(buildingObject(otherSiteId));

        assertThatThrownBy(() -> assetService.relocateAsset(assetId, targetSiteId, targetSpaceId))
            .isInstanceOf(ValidationException.class)
            .hasMessageContaining("Target space does not belong to the target site");

        verify(objectRepository, never()).save(any());
    }

    @Test
    void relocateAsset_NullTargetSite_ThrowsValidation() {
        UUID assetId = UUID.randomUUID();

        assertThatThrownBy(() -> assetService.relocateAsset(assetId, null, null))
            .isInstanceOf(ValidationException.class)
            .hasMessageContaining("Target site ID must be provided");

        verify(objectRepository, never()).save(any());
    }

    @Test
    void relocateAsset_NamePreserved() {
        UUID assetId = UUID.randomUUID();
        UUID newSiteId = UUID.randomUUID();

        ObjectEntity asset = new ObjectEntity();
        asset.setId(assetId);
        asset.setDisplayName("Energy Meter");
        asset.setProperties("{}");

        ObjectEntity newSite = new ObjectEntity();
        newSite.setId(newSiteId);

        given(objectRepository.findById(assetId)).willReturn(Optional.of(asset));
        given(objectRepository.findById(newSiteId)).willReturn(Optional.of(newSite));
        given(ontologyService.resolveTargetId(assetId, OntologyService.INSTALLED_AT)).willReturn(UUID.randomUUID());
        given(objectRepository.save(any(ObjectEntity.class))).willAnswer(inv -> inv.getArgument(0));
        given(ontologyService.resolveTargetId(assetId, OntologyService.INSTALLED_IN)).willReturn(null);

        AssetDTO result = assetService.relocateAsset(assetId, newSiteId, null);

        assertThat(result.name()).isEqualTo("Energy Meter");
    }

    // --- Smart Downsampling Tests ---

    @Test
    void calculateBucketMinutes_6hOrLess_Returns1() {
        Instant now = Instant.now();
        assertThat(assetService.calculateBucketMinutes(now.minus(3, ChronoUnit.HOURS), now)).isEqualTo(1);
        assertThat(assetService.calculateBucketMinutes(now.minus(6, ChronoUnit.HOURS), now)).isEqualTo(1);
    }

    @Test
    void calculateBucketMinutes_2dOrLess_Returns5() {
        Instant now = Instant.now();
        assertThat(assetService.calculateBucketMinutes(now.minus(24, ChronoUnit.HOURS), now)).isEqualTo(5);
        assertThat(assetService.calculateBucketMinutes(now.minus(48, ChronoUnit.HOURS), now)).isEqualTo(5);
    }

    @Test
    void calculateBucketMinutes_7dOrLess_Returns15() {
        Instant now = Instant.now();
        assertThat(assetService.calculateBucketMinutes(now.minus(5, ChronoUnit.DAYS), now)).isEqualTo(15);
        assertThat(assetService.calculateBucketMinutes(now.minus(7, ChronoUnit.DAYS), now)).isEqualTo(15);
    }

    @Test
    void calculateBucketMinutes_30dOrLess_Returns60() {
        Instant now = Instant.now();
        assertThat(assetService.calculateBucketMinutes(now.minus(14, ChronoUnit.DAYS), now)).isEqualTo(60);
        assertThat(assetService.calculateBucketMinutes(now.minus(30, ChronoUnit.DAYS), now)).isEqualTo(60);
    }

    @Test
    void calculateBucketMinutes_90dOrLess_Returns360() {
        Instant now = Instant.now();
        assertThat(assetService.calculateBucketMinutes(now.minus(60, ChronoUnit.DAYS), now)).isEqualTo(360);
        assertThat(assetService.calculateBucketMinutes(now.minus(90, ChronoUnit.DAYS), now)).isEqualTo(360);
    }

    @Test
    void calculateBucketMinutes_Over90d_Returns1440() {
        Instant now = Instant.now();
        assertThat(assetService.calculateBucketMinutes(now.minus(180, ChronoUnit.DAYS), now)).isEqualTo(1440);
    }

    // --- Helpers ---

    private ObjectEntity buildingObject(UUID id) {
        ObjectType buildingType = new ObjectType();
        buildingType.setName("BUILDING");
        ObjectEntity obj = new ObjectEntity();
        obj.setId(id);
        obj.setObjectType(buildingType);
        return obj;
    }
}
