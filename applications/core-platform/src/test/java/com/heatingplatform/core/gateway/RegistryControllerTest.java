package com.heatingplatform.core.gateway;

import com.heatingplatform.core.ontology.RegistryController;

import com.heatingplatform.core.device.DeviceTemplate;
import com.heatingplatform.core.ontology.ObjectType;
import com.heatingplatform.core.tenant.Tenant;
import com.heatingplatform.core.device.DeviceTemplateRepository;
import com.heatingplatform.core.ontology.ObjectTypeRepository;
import com.heatingplatform.core.tenant.TenantRepository;
import com.heatingplatform.core.user.AuthService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import java.time.Instant;
import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class RegistryControllerTest {

    @Mock
    private ObjectTypeRepository objectTypeRepository;

    @Mock
    private DeviceTemplateRepository deviceTemplateRepository;

    @Mock
    private TenantRepository tenantRepository;

    @Mock
    private AuthService authService;

    @InjectMocks
    private RegistryController registryController;

    private ObjectType objectType;
    private DeviceTemplate systemTemplate;
    private DeviceTemplate tenantTemplate;
    private Tenant tenant;

    @BeforeEach
    void setUp() {
        tenant = new Tenant();
        tenant.setId(UUID.randomUUID());
        tenant.setName("Test Tenant");

        objectType = new ObjectType();
        objectType.setId(UUID.randomUUID());
        objectType.setName("heating_boiler");
        objectType.setDisplayName("Heating Boiler");
        objectType.setCategory("heating");
        objectType.setActive(true);
        objectType.setCreatedAt(Instant.now());

        systemTemplate = new DeviceTemplate();
        systemTemplate.setId(UUID.randomUUID());
        systemTemplate.setName("Dragino LHT65");
        systemTemplate.setManufacturer("Dragino");
        systemTemplate.setProtocol("LORAWAN");
        systemTemplate.setTenant(null); // system-wide
        systemTemplate.setObjectType(objectType);
        systemTemplate.setActive(true);
        systemTemplate.setCreatedAt(Instant.now());

        tenantTemplate = new DeviceTemplate();
        tenantTemplate.setId(UUID.randomUUID());
        tenantTemplate.setName("Custom Sensor");
        tenantTemplate.setTenant(tenant);
        tenantTemplate.setActive(true);
        tenantTemplate.setCreatedAt(Instant.now());
    }

    @Nested
    class CreateObjectType {

        @Test
        void shouldCreateObjectTypeWhenSystemAdmin() {
            given(authService.isSystemAdmin()).willReturn(true);
            given(objectTypeRepository.save(any(ObjectType.class))).willAnswer(inv -> {
                ObjectType ot = inv.getArgument(0);
                ot.setId(UUID.randomUUID());
                return ot;
            });

            ResponseEntity<Map<String, Object>> response = registryController.createObjectType(
                    Map.of("name", "heat_pump", "displayName", "Heat Pump", "category", "heating"));

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);
            @SuppressWarnings("unchecked")
            Map<String, Object> ot = (Map<String, Object>) response.getBody().get("objectType");
            assertThat(ot.get("name")).isEqualTo("heat_pump");
            assertThat(ot.get("displayName")).isEqualTo("Heat Pump");
        }

        @Test
        void shouldReturn403WhenNotSystemAdmin() {
            given(authService.isSystemAdmin()).willReturn(false);

            ResponseEntity<Map<String, Object>> response = registryController.createObjectType(
                    Map.of("name", "test", "displayName", "Test", "category", "test"));

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
            verify(objectTypeRepository, never()).save(any());
        }
    }

    @Nested
    class UpdateObjectType {

        @Test
        void shouldUpdateObjectType() {
            given(authService.isSystemAdmin()).willReturn(true);
            given(objectTypeRepository.findById(objectType.getId())).willReturn(Optional.of(objectType));
            given(objectTypeRepository.save(any(ObjectType.class))).willAnswer(inv -> inv.getArgument(0));

            ResponseEntity<Map<String, Object>> response = registryController.updateObjectType(
                    objectType.getId().toString(),
                    Map.of("displayName", "Updated Boiler"));

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
            assertThat(objectType.getDisplayName()).isEqualTo("Updated Boiler");
            assertThat(objectType.getUpdatedAt()).isNotNull();
        }

        @Test
        void shouldReturn403WhenNotSystemAdmin() {
            given(authService.isSystemAdmin()).willReturn(false);

            ResponseEntity<Map<String, Object>> response = registryController.updateObjectType(
                    objectType.getId().toString(), Map.of("displayName", "Nope"));

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        }
    }

    @Nested
    class DeleteObjectType {

        @Test
        void shouldSoftDeleteObjectType() {
            given(authService.isSystemAdmin()).willReturn(true);
            given(objectTypeRepository.findById(objectType.getId())).willReturn(Optional.of(objectType));
            given(objectTypeRepository.save(any(ObjectType.class))).willAnswer(inv -> inv.getArgument(0));

            ResponseEntity<Map<String, Object>> response =
                    registryController.deleteObjectType(objectType.getId().toString());

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
            assertThat(objectType.getActive()).isFalse();
        }
    }

    @Nested
    class CreateDeviceTemplate {

        @Test
        void shouldCreateSystemWideTemplateWhenAdmin() {
            given(authService.isConsultantOrAdmin()).willReturn(true);
            given(authService.isSystemAdmin()).willReturn(true);
            given(deviceTemplateRepository.save(any(DeviceTemplate.class))).willAnswer(inv -> {
                DeviceTemplate dt = inv.getArgument(0);
                dt.setId(UUID.randomUUID());
                return dt;
            });

            ResponseEntity<Map<String, Object>> response = registryController.createDeviceTemplate(
                    Map.of("name", "New Template", "manufacturer", "Acme", "protocol", "LORAWAN"));

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);
            @SuppressWarnings("unchecked")
            Map<String, Object> dt = (Map<String, Object>) response.getBody().get("deviceTemplate");
            assertThat(dt.get("name")).isEqualTo("New Template");
        }

        @Test
        void shouldCreateTenantScopedTemplateWhenManager() {
            given(authService.isManagerInTenant(tenant.getId())).willReturn(true);
            given(tenantRepository.findById(tenant.getId())).willReturn(Optional.of(tenant));
            given(deviceTemplateRepository.save(any(DeviceTemplate.class))).willAnswer(inv -> {
                DeviceTemplate dt = inv.getArgument(0);
                dt.setId(UUID.randomUUID());
                return dt;
            });

            ResponseEntity<Map<String, Object>> response = registryController.createDeviceTemplate(
                    Map.of("name", "Tenant Template", "tenantId", tenant.getId().toString()));

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        }

        @Test
        void shouldReturn403ForSystemWideWhenNotAdmin() {
            given(authService.isConsultantOrAdmin()).willReturn(false);

            ResponseEntity<Map<String, Object>> response = registryController.createDeviceTemplate(
                    Map.of("name", "System Template"));

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        }

        @Test
        void shouldReturn403ForTenantScopedWhenNotManager() {
            given(authService.isManagerInTenant(tenant.getId())).willReturn(false);

            ResponseEntity<Map<String, Object>> response = registryController.createDeviceTemplate(
                    Map.of("name", "Template", "tenantId", tenant.getId().toString()));

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        }
    }

    @Nested
    class UpdateDeviceTemplate {

        @Test
        void shouldUpdateSystemWideTemplate() {
            given(deviceTemplateRepository.findById(systemTemplate.getId()))
                    .willReturn(Optional.of(systemTemplate));
            given(authService.isSystemAdmin()).willReturn(true);
            given(deviceTemplateRepository.save(any(DeviceTemplate.class))).willAnswer(inv -> inv.getArgument(0));

            ResponseEntity<Map<String, Object>> response = registryController.updateDeviceTemplate(
                    systemTemplate.getId().toString(),
                    Map.of("name", "Updated Template"));

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
            assertThat(systemTemplate.getName()).isEqualTo("Updated Template");
        }

        @Test
        void shouldUpdateTenantScopedTemplateAsManager() {
            given(deviceTemplateRepository.findById(tenantTemplate.getId()))
                    .willReturn(Optional.of(tenantTemplate));
            given(authService.isManagerInTenant(tenant.getId())).willReturn(true);
            given(deviceTemplateRepository.save(any(DeviceTemplate.class))).willAnswer(inv -> inv.getArgument(0));

            ResponseEntity<Map<String, Object>> response = registryController.updateDeviceTemplate(
                    tenantTemplate.getId().toString(),
                    Map.of("name", "Renamed Sensor"));

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
            assertThat(tenantTemplate.getName()).isEqualTo("Renamed Sensor");
        }

        @Test
        void shouldReturn403ForSystemWideWhenNotAdmin() {
            given(deviceTemplateRepository.findById(systemTemplate.getId()))
                    .willReturn(Optional.of(systemTemplate));
            given(authService.isSystemAdmin()).willReturn(false);

            ResponseEntity<Map<String, Object>> response = registryController.updateDeviceTemplate(
                    systemTemplate.getId().toString(), Map.of("name", "Nope"));

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        }
    }

    @Nested
    class DeleteDeviceTemplate {

        @Test
        void shouldSoftDeleteSystemWideTemplate() {
            given(deviceTemplateRepository.findById(systemTemplate.getId()))
                    .willReturn(Optional.of(systemTemplate));
            given(authService.isSystemAdmin()).willReturn(true);
            given(deviceTemplateRepository.save(any(DeviceTemplate.class))).willAnswer(inv -> inv.getArgument(0));

            ResponseEntity<Map<String, Object>> response =
                    registryController.deleteDeviceTemplate(systemTemplate.getId().toString());

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
            assertThat(systemTemplate.getActive()).isFalse();
        }

        @Test
        void shouldSoftDeleteTenantScopedTemplate() {
            given(deviceTemplateRepository.findById(tenantTemplate.getId()))
                    .willReturn(Optional.of(tenantTemplate));
            given(authService.isManagerInTenant(tenant.getId())).willReturn(true);
            given(deviceTemplateRepository.save(any(DeviceTemplate.class))).willAnswer(inv -> inv.getArgument(0));

            ResponseEntity<Map<String, Object>> response =
                    registryController.deleteDeviceTemplate(tenantTemplate.getId().toString());

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
            assertThat(tenantTemplate.getActive()).isFalse();
        }
    }
}
