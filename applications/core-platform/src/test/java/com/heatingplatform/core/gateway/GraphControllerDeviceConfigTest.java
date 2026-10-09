package com.heatingplatform.core.gateway;

import com.heatingplatform.core.tenancy.TenantBodyGuard;
import com.heatingplatform.core.ontology.GraphController;

import com.heatingplatform.core.ontology.ObjectEntity;
import com.heatingplatform.core.ontology.ObjectType;
import com.heatingplatform.core.device.PhysicalDevice;
import com.heatingplatform.core.tenant.Tenant;
import com.heatingplatform.core.common.exception.ResourceNotFoundException;
import com.heatingplatform.core.ontology.LinkRepository;
import com.heatingplatform.core.ontology.LinkTypeRepository;
import com.heatingplatform.core.metricpoint.MetricPointRepository;
import com.heatingplatform.core.ontology.ObjectRepository;
import com.heatingplatform.core.ontology.ObjectTypeRepository;
import com.heatingplatform.core.device.PhysicalDeviceRepository;
import com.heatingplatform.core.project.ProjectObjectRepository;
import com.heatingplatform.core.user.AuthService;
import com.heatingplatform.core.metricpoint.MetricPointService;
import com.heatingplatform.core.ontology.OntologyService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import java.time.Instant;
import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/**
 * Unit tests for GraphController device config endpoints:
 *   - POST /objects with device extension (specs stored in ObjectEntity.properties)
 *   - GET /objects/{id}/device
 *   - PATCH /objects/{id}/device
 *
 * After V12: device_id, type, model_human, signal_map removed from assets table.
 * Specs live in ObjectEntity.properties (JSONB). Device identity lives on
 * PhysicalDevice (linked via REALIZED_BY). There is no separate Asset row for
 * object creation or device config — all state is on the ObjectEntity.
 */
@ExtendWith(MockitoExtension.class)
class GraphControllerDeviceConfigTest {

    @Mock private OntologyService ontologyService;
    @Mock private MetricPointService metricPointService;
    @Mock private LinkTypeRepository linkTypeRepository;
    @Mock private LinkRepository linkRepository;
    @Mock private MetricPointRepository metricPointRepository;
    @Mock private ObjectRepository objectRepository;
    @Mock private ObjectTypeRepository objectTypeRepository;
    @Mock private ProjectObjectRepository projectObjectRepository;
    @Mock private PhysicalDeviceRepository physicalDeviceRepository;
    @Mock private AuthService authService;
    @Mock private TenantBodyGuard tenantBodyGuard;

    @InjectMocks
    private GraphController graphController;

    private UUID objectId;
    private UUID tenantId;
    private ObjectEntity objectEntity;
    private ObjectType objectType;

    @BeforeEach
    void setUp() {
        objectId = UUID.randomUUID();
        tenantId = UUID.randomUUID();

        objectType = new ObjectType();
        objectType.setId(UUID.randomUUID());
        objectType.setName("GENERIC_SENSOR");
        objectType.setDisplayName("Sensor");
        objectType.setCategory("SENSOR");
        objectType.setIcon("activity");

        objectEntity = new ObjectEntity();
        objectEntity.setId(objectId);
        objectEntity.setDisplayName("Test Sensor");
        objectEntity.setObjectType(objectType);
        objectEntity.setProperties("{}");
        objectEntity.setCreatedAt(Instant.now());
        objectEntity.setUpdatedAt(Instant.now());
    }

    // =========================================================================
    // POST /objects with device extension
    // =========================================================================

    @Nested
    class CreateObjectWithDevice {

        @Test
        void createsObjectAndSetsSpecs_WhenDevicePayloadWithSpecsProvided() {
            when(ontologyService.createObject("GENERIC_SENSOR", tenantId, "Test Sensor"))
                    .thenReturn(objectEntity);

            Map<String, Object> device = Map.of(
                    "deviceId", "shelly-AABB",
                    "modelHuman", "Shelly 2.5"
            );
            Map<String, Object> body = new HashMap<>();
            body.put("objectTypeName", "GENERIC_SENSOR");
            body.put("displayName", "Test Sensor");
            body.put("tenantId", tenantId.toString());
            body.put("device", device);

            ResponseEntity<?> response = graphController.createObject(body);

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);
            // No specs in payload means objectRepository.save is NOT called by applyDeviceSpecs
            verify(objectRepository, never()).save(any(ObjectEntity.class));
        }

        @Test
        void createsObjectWithoutApplyingSpecs_WhenNoDevicePayload() {
            when(ontologyService.createObject("HEATING_CIRCUIT", tenantId, "Heizkreis"))
                    .thenReturn(objectEntity);

            Map<String, Object> body = new HashMap<>();
            body.put("objectTypeName", "HEATING_CIRCUIT");
            body.put("displayName", "Heizkreis");
            body.put("tenantId", tenantId.toString());

            ResponseEntity<?> response = graphController.createObject(body);

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);
            // No device payload — applyDeviceSpecs not called
            verify(objectRepository, never()).save(any(ObjectEntity.class));
        }

        @Test
        void createsObject_WhenDevicePayloadHasNoSpecs() {
            // device payload present but no "specs" key — applyDeviceSpecs is a no-op
            when(ontologyService.createObject("GENERIC_SENSOR", tenantId, "Sensor"))
                    .thenReturn(objectEntity);

            Map<String, Object> device = new HashMap<>();
            Map<String, Object> body = new HashMap<>();
            body.put("objectTypeName", "GENERIC_SENSOR");
            body.put("displayName", "Sensor");
            body.put("tenantId", tenantId.toString());
            body.put("device", device);

            ResponseEntity<?> response = graphController.createObject(body);

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);
            verify(objectRepository, never()).save(any(ObjectEntity.class));
        }

        @Test
        void parsesSpecsFromDevicePayload_AndSavesOnObjectEntity() {
            when(ontologyService.createObject("GENERIC_SENSOR", tenantId, "EM Sensor"))
                    .thenReturn(objectEntity);
            when(objectRepository.save(any(ObjectEntity.class))).thenAnswer(inv -> inv.getArgument(0));

            Map<String, Object> device = new HashMap<>();
            device.put("deviceId", "em-device");
            device.put("specs", Map.of("channels", 3));

            Map<String, Object> body = new HashMap<>();
            body.put("objectTypeName", "GENERIC_SENSOR");
            body.put("displayName", "EM Sensor");
            body.put("tenantId", tenantId.toString());
            body.put("device", device);

            ResponseEntity<?> response = graphController.createObject(body);

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);

            // Specs in device payload triggers objectRepository.save with updated properties
            ArgumentCaptor<ObjectEntity> captor = ArgumentCaptor.forClass(ObjectEntity.class);
            verify(objectRepository).save(captor.capture());
            assertThat(captor.getValue().getProperties()).contains("channels");
        }
    }

    // =========================================================================
    // GET /objects/{id}/device
    // =========================================================================

    @Nested
    class GetDeviceConfig {

        @Test
        void returnsDeviceConfig_WhenObjectExists() {
            objectEntity.setProperties("{}");
            objectEntity.setDisplayName("Test Sensor");

            when(objectRepository.findById(objectId)).thenReturn(Optional.of(objectEntity));
            // No REALIZED_BY link configured — deviceId will be null
            when(ontologyService.resolveTargetId(objectId, OntologyService.REALIZED_BY)).thenReturn(null);
            when(metricPointRepository.findSignalMapRowsByAssetId(objectId)).thenReturn(List.of());

            ResponseEntity<?> response = graphController.getDeviceConfig(objectId.toString());

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
            @SuppressWarnings("unchecked")
            Map<String, Object> body = (Map<String, Object>) response.getBody();
            assertThat(body).containsKey("device");

            @SuppressWarnings("unchecked")
            Map<String, Object> device = (Map<String, Object>) body.get("device");
            assertThat(device.get("objectId")).isEqualTo(objectId.toString());
            assertThat(device.get("name")).isEqualTo("Test Sensor");
            // deviceId is resolved via PhysicalDevice — null when no REALIZED_BY link
            assertThat(device.get("deviceId")).isNull();
        }

        @Test
        void returnsDeviceIdFromLinkedPhysicalDevice() {
            objectEntity.setProperties("{}");
            objectEntity.setDisplayName("Test Sensor");

            UUID physDevId = UUID.randomUUID();
            PhysicalDevice pd = new PhysicalDevice();
            pd.setId(physDevId);
            pd.setDeviceId("shelly-1234");
            pd.setModel("Shelly Pro 3EM");

            when(objectRepository.findById(objectId)).thenReturn(Optional.of(objectEntity));
            when(ontologyService.resolveTargetId(objectId, OntologyService.REALIZED_BY)).thenReturn(physDevId);
            when(physicalDeviceRepository.findById(physDevId)).thenReturn(Optional.of(pd));
            when(metricPointRepository.findSignalMapRowsByAssetId(objectId)).thenReturn(List.of());

            ResponseEntity<?> response = graphController.getDeviceConfig(objectId.toString());

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
            @SuppressWarnings("unchecked")
            Map<String, Object> body = (Map<String, Object>) response.getBody();
            @SuppressWarnings("unchecked")
            Map<String, Object> device = (Map<String, Object>) body.get("device");
            assertThat(device.get("deviceId")).isEqualTo("shelly-1234");
            assertThat(device.get("modelHuman")).isEqualTo("Shelly Pro 3EM");
        }

        @Test
        void returns404_WhenObjectDoesNotExist() {
            when(objectRepository.findById(objectId)).thenReturn(Optional.empty());

            ResponseEntity<?> response = graphController.getDeviceConfig(objectId.toString());

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        }
    }

    // =========================================================================
    // PATCH /objects/{id}/device
    // =========================================================================

    @Nested
    class UpdateDeviceConfig {

        @Test
        void updatesSpecsOnObjectEntity_WhenSpecsProvided() {
            objectEntity.setProperties("{}");

            when(ontologyService.getObject(objectId)).thenReturn(objectEntity);
            when(objectRepository.save(any(ObjectEntity.class))).thenAnswer(inv -> inv.getArgument(0));
            // No REALIZED_BY link — physical device updates are no-ops
            when(ontologyService.resolveTargetId(objectId, OntologyService.REALIZED_BY)).thenReturn(null);
            when(metricPointRepository.findSignalMapRowsByAssetId(objectId)).thenReturn(List.of());

            Map<String, Object> body = new HashMap<>();
            body.put("specs", Map.of("channels", 3, "firmware", "1.0.0"));

            ResponseEntity<?> response = graphController.updateDeviceConfig(objectId.toString(), body);

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);

            ArgumentCaptor<ObjectEntity> captor = ArgumentCaptor.forClass(ObjectEntity.class);
            verify(objectRepository).save(captor.capture());
            assertThat(captor.getValue().getProperties()).contains("channels");
        }

        @Test
        void updatesLinkedPhysicalDevice_WhenRealizedByLinkExists() {
            objectEntity.setProperties("{}");

            UUID physDevId = UUID.randomUUID();
            PhysicalDevice pd = new PhysicalDevice();
            pd.setId(physDevId);
            pd.setDeviceId("old-device");
            pd.setModel("Old Model");

            when(ontologyService.getObject(objectId)).thenReturn(objectEntity);
            when(ontologyService.resolveTargetId(objectId, OntologyService.REALIZED_BY)).thenReturn(physDevId);
            when(physicalDeviceRepository.findById(physDevId)).thenReturn(Optional.of(pd));
            when(physicalDeviceRepository.save(any(PhysicalDevice.class))).thenAnswer(inv -> inv.getArgument(0));
            when(metricPointRepository.findSignalMapRowsByAssetId(objectId)).thenReturn(List.of());

            Map<String, Object> body = new HashMap<>();
            body.put("deviceId", "new-device");
            body.put("modelHuman", "New Model");

            ResponseEntity<?> response = graphController.updateDeviceConfig(objectId.toString(), body);

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);

            ArgumentCaptor<PhysicalDevice> captor = ArgumentCaptor.forClass(PhysicalDevice.class);
            verify(physicalDeviceRepository).save(captor.capture());
            assertThat(captor.getValue().getDeviceId()).isEqualTo("new-device");
            assertThat(captor.getValue().getModel()).isEqualTo("New Model");
        }

        @Test
        void createsNewPhysicalDevice_WhenNoRealizedByLinkAndDeviceIdProvided() {
            Tenant tenant = new Tenant();
            tenant.setId(tenantId);
            objectEntity.setTenant(tenant);
            objectEntity.setProperties("{}");

            UUID pdObjectId = UUID.randomUUID();
            ObjectEntity pdObj = new ObjectEntity();
            pdObj.setId(pdObjectId);

            when(ontologyService.getObject(objectId)).thenReturn(objectEntity);
            when(ontologyService.resolveTargetId(objectId, OntologyService.REALIZED_BY)).thenReturn(null);
            when(physicalDeviceRepository.findByDeviceId("brand-new-device")).thenReturn(Optional.empty());
            when(ontologyService.createObject(OntologyService.PHYSICAL_DEVICE, tenantId, "brand-new-device"))
                    .thenReturn(pdObj);
            when(physicalDeviceRepository.save(any(PhysicalDevice.class))).thenAnswer(inv -> inv.getArgument(0));
            when(metricPointRepository.findSignalMapRowsByAssetId(objectId)).thenReturn(List.of());

            Map<String, Object> body = new HashMap<>();
            body.put("deviceId", "brand-new-device");

            ResponseEntity<?> response = graphController.updateDeviceConfig(objectId.toString(), body);

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
            // A new PhysicalDevice is created and linked via REALIZED_BY
            verify(physicalDeviceRepository).save(any(PhysicalDevice.class));
            verify(ontologyService).upsertLink(objectId, pdObjectId, OntologyService.REALIZED_BY);
        }

        @Test
        void returns404_WhenObjectDoesNotExist() {
            when(ontologyService.getObject(objectId)).thenThrow(new ResourceNotFoundException("Object", objectId));

            Map<String, Object> body = Map.of("deviceId", "some-device");

            ResponseEntity<?> response = graphController.updateDeviceConfig(objectId.toString(), body);

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
            verify(objectRepository, never()).save(any(ObjectEntity.class));
        }

        @Test
        void updatesExistingPhysicalDevice_WhenNoLinkButDeviceIdAlreadyExists() {
            objectEntity.setProperties("{}");

            UUID existingPdId = UUID.randomUUID();
            PhysicalDevice existingPd = new PhysicalDevice();
            existingPd.setId(existingPdId);
            existingPd.setDeviceId("existing-device");
            existingPd.setModel("Old Model");

            when(ontologyService.getObject(objectId)).thenReturn(objectEntity);
            when(ontologyService.resolveTargetId(objectId, OntologyService.REALIZED_BY)).thenReturn(null);
            when(physicalDeviceRepository.findByDeviceId("existing-device")).thenReturn(Optional.of(existingPd));
            when(physicalDeviceRepository.save(any(PhysicalDevice.class))).thenAnswer(inv -> inv.getArgument(0));
            when(metricPointRepository.findSignalMapRowsByAssetId(objectId)).thenReturn(List.of());

            Map<String, Object> body = new HashMap<>();
            body.put("deviceId", "existing-device");
            body.put("modelHuman", "New Model");

            ResponseEntity<?> response = graphController.updateDeviceConfig(objectId.toString(), body);

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
            // Existing device is updated and re-linked
            verify(physicalDeviceRepository).save(argThat(pd -> "New Model".equals(pd.getModel())));
            verify(ontologyService).upsertLink(objectId, existingPdId, OntologyService.REALIZED_BY);
        }
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    /**
     * Builds a minimal ObjectEntity with the given id, name, and empty properties.
     */
    private ObjectEntity buildObjectEntity(UUID id, String name) {
        ObjectType type = new ObjectType();
        type.setId(UUID.randomUUID());
        type.setName("GENERIC_SENSOR");
        type.setDisplayName("Sensor");
        type.setCategory("SENSOR");
        type.setIcon("activity");

        ObjectEntity obj = new ObjectEntity();
        obj.setId(id);
        obj.setDisplayName(name);
        obj.setObjectType(type);
        obj.setProperties("{}");
        obj.setCreatedAt(Instant.now());
        obj.setUpdatedAt(Instant.now());
        return obj;
    }
}
