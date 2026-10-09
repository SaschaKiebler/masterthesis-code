package com.heatingplatform.core.site;

import com.heatingplatform.core.asset.AssetDTO;
import com.heatingplatform.core.site.SiteDTO;
import com.heatingplatform.core.ontology.ObjectEntity;
import com.heatingplatform.core.common.exception.DuplicateResourceException;
import com.heatingplatform.core.common.exception.ResourceNotFoundException;
import com.heatingplatform.core.common.exception.ValidationException;
import com.heatingplatform.core.proto.v1.*;
import com.heatingplatform.core.asset.AssetService;
import com.heatingplatform.core.ontology.OntologyService;
import com.heatingplatform.core.site.SiteService;
import io.grpc.stub.StreamObserver;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.devh.boot.grpc.server.service.GrpcService;

import java.util.List;

@Slf4j
@GrpcService
@RequiredArgsConstructor
public class SiteServiceImpl extends SiteServiceGrpc.SiteServiceImplBase {

    private final SiteService siteService;
    private final AssetService assetService;

    @Override
    public void listSites(ListSitesRequest request, StreamObserver<ListSitesResponse> responseObserver) {
        try {
            log.info("gRPC ListSites called");
            List<SiteDTO> sites = siteService.getAllSites();

            ListSitesResponse.Builder responseBuilder = ListSitesResponse.newBuilder();

            for (SiteDTO site : sites) {
                SiteSummary summary = SiteSummary.newBuilder()
                    .setId(com.heatingplatform.core.proto.v1.UUID.newBuilder()
                        .setValue(site.id().toString())
                        .build())
                    .setName(site.name())
                    .setAddress(site.address())
                    .setAssetCount(site.assetCount())
                    .build();
                responseBuilder.addSites(summary);
            }

            PageInfo pageInfo = PageInfo.newBuilder()
                .setTotalItems(sites.size())
                .setTotalPages(1)
                .setCurrentPage(1)
                .setPageSize(sites.size())
                .build();

            responseBuilder.setPageInfo(pageInfo);

            responseObserver.onNext(responseBuilder.build());
            responseObserver.onCompleted();
        } catch (Exception e) {
            log.error("Error in listSites", e);
            responseObserver.onError(io.grpc.Status.INTERNAL
                .withDescription(e.getMessage())
                .asRuntimeException());
        }
    }

    @Override
    public void getSite(GetSiteRequest request, StreamObserver<GetSiteResponse> responseObserver) {
        try {
            log.info("gRPC GetSite called for ID: {}", request.getSiteId().getValue());
            java.util.UUID siteId = java.util.UUID.fromString(request.getSiteId().getValue());

            ObjectEntity siteEntity = siteService.getSiteById(siteId)
                .orElseThrow(() -> io.grpc.Status.NOT_FOUND
                    .withDescription("Site not found: " + siteId)
                    .asRuntimeException());

            List<AssetDTO> assets = assetService.getAssetsBySite(siteId);

            String address = OntologyService.extractProperty(siteEntity.getProperties(), "address");

            com.heatingplatform.core.proto.v1.Site siteProto = com.heatingplatform.core.proto.v1.Site.newBuilder()
                .setId(com.heatingplatform.core.proto.v1.UUID.newBuilder()
                    .setValue(siteEntity.getId().toString())
                    .build())
                .setTenantId(com.heatingplatform.core.proto.v1.UUID.newBuilder()
                    .setValue(siteEntity.getTenant().getId().toString())
                    .build())
                .setName(siteEntity.getDisplayName())
                .setAddress(address != null ? address : "")
                .build();

            GetSiteResponse.Builder responseBuilder = GetSiteResponse.newBuilder()
                .setSite(siteProto);

            for (AssetDTO asset : assets) {
                AssetSummary assetSummary = AssetSummary.newBuilder()
                    .setId(com.heatingplatform.core.proto.v1.UUID.newBuilder()
                        .setValue(asset.id().toString())
                        .build())
                    .setDeviceId("")
                    .setName(asset.name())
                    .setType("")
                    .setModelHuman("")
                    .setSignalMap(JsonValue.newBuilder()
                        .setJson("{}")
                        .build())
                    .build();
                responseBuilder.addAssets(assetSummary);
            }

            responseObserver.onNext(responseBuilder.build());
            responseObserver.onCompleted();
        } catch (io.grpc.StatusRuntimeException e) {
            responseObserver.onError(e);
        } catch (IllegalArgumentException e) {
            responseObserver.onError(io.grpc.Status.INVALID_ARGUMENT
                .withDescription("Invalid site ID format")
                .withCause(e)
                .asRuntimeException());
        } catch (Exception e) {
            log.error("Error in getSite", e);
            responseObserver.onError(io.grpc.Status.INTERNAL
                .withDescription(e.getMessage())
                .asRuntimeException());
        }
    }

    @Override
    public void createSite(CreateSiteRequest request, StreamObserver<CreateSiteResponse> responseObserver) {
        try {
            log.info("gRPC CreateSite called: {}", request.getName());

            java.util.UUID tenantId = java.util.UUID.fromString(request.getTenantId().getValue());

            String metadata = request.hasMetadata() ? request.getMetadata().getJson() : null;

            ObjectEntity created = siteService.createSite(
                tenantId,
                request.getName(),
                request.getAddress(),
                metadata
            );

            String address = OntologyService.extractProperty(created.getProperties(), "address");

            com.heatingplatform.core.proto.v1.Site siteProto = com.heatingplatform.core.proto.v1.Site.newBuilder()
                .setId(com.heatingplatform.core.proto.v1.UUID.newBuilder()
                    .setValue(created.getId().toString())
                    .build())
                .setTenantId(com.heatingplatform.core.proto.v1.UUID.newBuilder()
                    .setValue(created.getTenant().getId().toString())
                    .build())
                .setName(created.getDisplayName())
                .setAddress(address != null ? address : "")
                .build();

            CreateSiteResponse response = CreateSiteResponse.newBuilder()
                .setSite(siteProto)
                .build();

            responseObserver.onNext(response);
            responseObserver.onCompleted();

        } catch (ValidationException e) {
            responseObserver.onError(io.grpc.Status.INVALID_ARGUMENT
                .withDescription(e.getMessage())
                .asRuntimeException());
        } catch (ResourceNotFoundException e) {
            responseObserver.onError(io.grpc.Status.NOT_FOUND
                .withDescription(e.getMessage())
                .asRuntimeException());
        } catch (DuplicateResourceException e) {
            responseObserver.onError(io.grpc.Status.ALREADY_EXISTS
                .withDescription(e.getMessage())
                .asRuntimeException());
        } catch (IllegalArgumentException e) {
            responseObserver.onError(io.grpc.Status.INVALID_ARGUMENT
                .withDescription("Invalid tenant ID format")
                .withCause(e)
                .asRuntimeException());
        } catch (Exception e) {
            log.error("Error in createSite", e);
            responseObserver.onError(io.grpc.Status.INTERNAL
                .withDescription("Internal server error")
                .asRuntimeException());
        }
    }

    @Override
    public void registerAssets(RegisterAssetsRequest request, StreamObserver<RegisterAssetsResponse> responseObserver) {
        try {
            log.info("gRPC RegisterAssets called for site: {}", request.getSiteId().getValue());

            java.util.UUID siteId = java.util.UUID.fromString(request.getSiteId().getValue());

            List<AssetService.DeviceRegistrationRequest> devices = request.getDevicesList().stream()
                .map(d -> new AssetService.DeviceRegistrationRequest(
                    d.getDeviceId(),
                    d.getProtocol(),
                    d.getType(),
                    d.getName(),
                    null,
                    d.hasSignalMap() ? d.getSignalMap().getJson() : null,
                    d.hasSecrets() ? d.getSecrets().getJson() : null,
                    null
                ))
                .toList();

            List<AssetDTO> created = assetService.registerAssets(siteId, devices);

            RegisterAssetsResponse.Builder responseBuilder = RegisterAssetsResponse.newBuilder();

            for (AssetDTO asset : created) {
                AssetSummary assetSummary = AssetSummary.newBuilder()
                    .setId(com.heatingplatform.core.proto.v1.UUID.newBuilder()
                        .setValue(asset.id().toString())
                        .build())
                    .setDeviceId("")
                    .setName(asset.name())
                    .setType("")
                    .setModelHuman("")
                    .setSignalMap(JsonValue.newBuilder()
                        .setJson("{}")
                        .build())
                    .build();
                responseBuilder.addAssets(assetSummary);
            }

            responseObserver.onNext(responseBuilder.build());
            responseObserver.onCompleted();

        } catch (ValidationException e) {
            responseObserver.onError(io.grpc.Status.INVALID_ARGUMENT
                .withDescription(e.getMessage())
                .asRuntimeException());
        } catch (ResourceNotFoundException e) {
            responseObserver.onError(io.grpc.Status.NOT_FOUND
                .withDescription(e.getMessage())
                .asRuntimeException());
        } catch (DuplicateResourceException e) {
            responseObserver.onError(io.grpc.Status.ALREADY_EXISTS
                .withDescription(e.getMessage())
                .asRuntimeException());
        } catch (IllegalArgumentException e) {
            responseObserver.onError(io.grpc.Status.INVALID_ARGUMENT
                .withDescription("Invalid site ID format")
                .withCause(e)
                .asRuntimeException());
        } catch (Exception e) {
            log.error("Error in registerAssets", e);
            responseObserver.onError(io.grpc.Status.INTERNAL
                .withDescription("Internal server error")
                .asRuntimeException());
        }
    }
}
