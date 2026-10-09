package com.heatingplatform.core.grpc;

import com.heatingplatform.core.site.SiteServiceImpl;

import com.heatingplatform.core.asset.AssetDTO;
import com.heatingplatform.core.site.SiteDTO;
import com.heatingplatform.core.ontology.ObjectEntity;
import com.heatingplatform.core.ontology.ObjectType;
import com.heatingplatform.core.tenant.Tenant;
import com.heatingplatform.core.common.exception.DuplicateResourceException;
import com.heatingplatform.core.common.exception.ResourceNotFoundException;
import com.heatingplatform.core.common.exception.ValidationException;
import com.heatingplatform.core.proto.v1.*;
import com.heatingplatform.core.asset.AssetService;
import com.heatingplatform.core.site.SiteService;
import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import io.grpc.stub.StreamObserver;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
class SiteServiceImplTest {

    @Mock
    private SiteService siteService;

    @Mock
    private AssetService assetService;

    @InjectMocks
    private SiteServiceImpl siteServiceImpl;

    @Mock
    private StreamObserver<CreateSiteResponse> createSiteObserver;

    @Mock
    private StreamObserver<RegisterAssetsResponse> registerAssetsObserver;

    @Mock
    private StreamObserver<ListSitesResponse> listSitesObserver;

    @Test
    void createSite_Success() {
        java.util.UUID tenantId = java.util.UUID.randomUUID();
        java.util.UUID siteId = java.util.UUID.randomUUID();

        Tenant tenant = new Tenant();
        tenant.setId(tenantId);

        ObjectType buildingType = new ObjectType();
        buildingType.setName("BUILDING");

        ObjectEntity created = new ObjectEntity();
        created.setId(siteId);
        created.setTenant(tenant);
        created.setDisplayName("Test Site");
        created.setObjectType(buildingType);
        created.setProperties("{\"address\":\"{\\\"street\\\":\\\"123 Main\\\"}\"}");

        given(siteService.createSite(eq(tenantId), eq("Test Site"), eq("{\"street\":\"123 Main\"}"), any()))
            .willReturn(created);

        CreateSiteRequest request = CreateSiteRequest.newBuilder()
            .setTenantId(com.heatingplatform.core.proto.v1.UUID.newBuilder().setValue(tenantId.toString()).build())
            .setName("Test Site")
            .setAddress("{\"street\":\"123 Main\"}")
            .build();

        siteServiceImpl.createSite(request, createSiteObserver);

        ArgumentCaptor<CreateSiteResponse> captor = ArgumentCaptor.forClass(CreateSiteResponse.class);
        verify(createSiteObserver).onNext(captor.capture());
        verify(createSiteObserver).onCompleted();

        CreateSiteResponse response = captor.getValue();
        assertThat(response.getSite().getId().getValue()).isEqualTo(siteId.toString());
        assertThat(response.getSite().getName()).isEqualTo("Test Site");
        assertThat(response.getSite().getTenantId().getValue()).isEqualTo(tenantId.toString());
    }

    @Test
    void createSite_ValidationError_ReturnsInvalidArgument() {
        java.util.UUID tenantId = java.util.UUID.randomUUID();

        given(siteService.createSite(eq(tenantId), eq(""), any(), any()))
            .willThrow(new ValidationException("Site name must not be empty"));

        CreateSiteRequest request = CreateSiteRequest.newBuilder()
            .setTenantId(com.heatingplatform.core.proto.v1.UUID.newBuilder().setValue(tenantId.toString()).build())
            .setName("")
            .setAddress("{}")
            .build();

        siteServiceImpl.createSite(request, createSiteObserver);

        ArgumentCaptor<Throwable> captor = ArgumentCaptor.forClass(Throwable.class);
        verify(createSiteObserver).onError(captor.capture());

        StatusRuntimeException ex = (StatusRuntimeException) captor.getValue();
        assertThat(ex.getStatus().getCode()).isEqualTo(Status.Code.INVALID_ARGUMENT);
    }

    @Test
    void createSite_DuplicateName_ReturnsAlreadyExists() {
        java.util.UUID tenantId = java.util.UUID.randomUUID();

        given(siteService.createSite(eq(tenantId), eq("Existing"), any(), any()))
            .willThrow(new DuplicateResourceException("Site already exists: Existing"));

        CreateSiteRequest request = CreateSiteRequest.newBuilder()
            .setTenantId(com.heatingplatform.core.proto.v1.UUID.newBuilder().setValue(tenantId.toString()).build())
            .setName("Existing")
            .setAddress("{}")
            .build();

        siteServiceImpl.createSite(request, createSiteObserver);

        ArgumentCaptor<Throwable> captor = ArgumentCaptor.forClass(Throwable.class);
        verify(createSiteObserver).onError(captor.capture());

        StatusRuntimeException ex = (StatusRuntimeException) captor.getValue();
        assertThat(ex.getStatus().getCode()).isEqualTo(Status.Code.ALREADY_EXISTS);
    }

    @Test
    void createSite_TenantNotFound_ReturnsNotFound() {
        java.util.UUID tenantId = java.util.UUID.randomUUID();

        given(siteService.createSite(eq(tenantId), eq("Site"), any(), any()))
            .willThrow(new ResourceNotFoundException("Tenant", tenantId));

        CreateSiteRequest request = CreateSiteRequest.newBuilder()
            .setTenantId(com.heatingplatform.core.proto.v1.UUID.newBuilder().setValue(tenantId.toString()).build())
            .setName("Site")
            .setAddress("{}")
            .build();

        siteServiceImpl.createSite(request, createSiteObserver);

        ArgumentCaptor<Throwable> captor = ArgumentCaptor.forClass(Throwable.class);
        verify(createSiteObserver).onError(captor.capture());

        StatusRuntimeException ex = (StatusRuntimeException) captor.getValue();
        assertThat(ex.getStatus().getCode()).isEqualTo(Status.Code.NOT_FOUND);
    }

    @Test
    void registerAssets_Success() {
        java.util.UUID siteId = java.util.UUID.randomUUID();
        java.util.UUID assetId = java.util.UUID.randomUUID();

        // AssetDTO no longer has deviceId/type/modelHuman/signalMap (removed in V12)
        AssetDTO assetDTO = new AssetDTO(assetId, siteId, null, "Sensor 1", "{}");
        given(assetService.registerAssets(eq(siteId), any())).willReturn(List.of(assetDTO));

        RegisterAssetsRequest request = RegisterAssetsRequest.newBuilder()
            .setSiteId(com.heatingplatform.core.proto.v1.UUID.newBuilder().setValue(siteId.toString()).build())
            .addDevices(DeviceRegistration.newBuilder()
                .setDeviceId("DEV001")
                .setType("SENSOR")
                .setName("Sensor 1")
                .setProtocol("lora")
                .build())
            .build();

        siteServiceImpl.registerAssets(request, registerAssetsObserver);

        ArgumentCaptor<RegisterAssetsResponse> captor = ArgumentCaptor.forClass(RegisterAssetsResponse.class);
        verify(registerAssetsObserver).onNext(captor.capture());
        verify(registerAssetsObserver).onCompleted();

        RegisterAssetsResponse response = captor.getValue();
        assertThat(response.getAssetsList()).hasSize(1);
        // device_id removed from assets in V12 — proto field returns empty string
        assertThat(response.getAssets(0).getDeviceId()).isEqualTo("");
        assertThat(response.getAssets(0).getName()).isEqualTo("Sensor 1");
    }

    @Test
    void registerAssets_SiteNotFound_ReturnsNotFound() {
        java.util.UUID siteId = java.util.UUID.randomUUID();

        given(assetService.registerAssets(eq(siteId), any()))
            .willThrow(new ResourceNotFoundException("Site", siteId));

        RegisterAssetsRequest request = RegisterAssetsRequest.newBuilder()
            .setSiteId(com.heatingplatform.core.proto.v1.UUID.newBuilder().setValue(siteId.toString()).build())
            .addDevices(DeviceRegistration.newBuilder()
                .setDeviceId("DEV001")
                .setType("SENSOR")
                .setName("Sensor")
                .build())
            .build();

        siteServiceImpl.registerAssets(request, registerAssetsObserver);

        ArgumentCaptor<Throwable> captor = ArgumentCaptor.forClass(Throwable.class);
        verify(registerAssetsObserver).onError(captor.capture());

        StatusRuntimeException ex = (StatusRuntimeException) captor.getValue();
        assertThat(ex.getStatus().getCode()).isEqualTo(Status.Code.NOT_FOUND);
    }

    @Test
    void registerAssets_DuplicateDevice_ReturnsAlreadyExists() {
        java.util.UUID siteId = java.util.UUID.randomUUID();

        given(assetService.registerAssets(eq(siteId), any()))
            .willThrow(new DuplicateResourceException("Device already registered: DEV001"));

        RegisterAssetsRequest request = RegisterAssetsRequest.newBuilder()
            .setSiteId(com.heatingplatform.core.proto.v1.UUID.newBuilder().setValue(siteId.toString()).build())
            .addDevices(DeviceRegistration.newBuilder()
                .setDeviceId("DEV001")
                .setType("SENSOR")
                .setName("Sensor")
                .build())
            .build();

        siteServiceImpl.registerAssets(request, registerAssetsObserver);

        ArgumentCaptor<Throwable> captor = ArgumentCaptor.forClass(Throwable.class);
        verify(registerAssetsObserver).onError(captor.capture());

        StatusRuntimeException ex = (StatusRuntimeException) captor.getValue();
        assertThat(ex.getStatus().getCode()).isEqualTo(Status.Code.ALREADY_EXISTS);
    }
}
