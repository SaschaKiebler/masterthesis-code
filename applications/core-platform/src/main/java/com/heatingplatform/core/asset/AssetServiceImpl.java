package com.heatingplatform.core.asset;

import com.heatingplatform.core.proto.v1.*;
import com.heatingplatform.core.asset.AssetService;
import com.heatingplatform.core.asset.AssetDTO;
import com.google.protobuf.Timestamp;
import io.grpc.stub.StreamObserver;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.devh.boot.grpc.server.service.GrpcService;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

@Slf4j
@GrpcService
@RequiredArgsConstructor
public class AssetServiceImpl extends AssetServiceGrpc.AssetServiceImplBase {
    
    private final AssetService assetService;
    
    @Override
    public void getAsset(GetAssetRequest request, StreamObserver<GetAssetResponse> responseObserver) {
        try {
            log.info("gRPC GetAsset called for ID: {}", request.getAssetId().getValue());
            java.util.UUID assetId = java.util.UUID.fromString(request.getAssetId().getValue());
            
            AssetDTO assetDTO = assetService.getAssetById(assetId)
                .orElseThrow(() -> io.grpc.Status.NOT_FOUND
                    .withDescription("Asset not found: " + assetId)
                    .asRuntimeException());
            
            // device_id, type, model_human, signal_map were removed from assets in V12.
            // Those fields are now on physical_devices and metric_points respectively.
            // Return empty strings for backward-compat proto fields.
            Asset.Builder assetBuilder = Asset.newBuilder()
                .setId(com.heatingplatform.core.proto.v1.UUID.newBuilder()
                    .setValue(assetDTO.id().toString())
                    .build())
                .setDeviceId("")
                .setName(assetDTO.name())
                .setType("")
                .setModelHuman("")
                .setSignalMap(JsonValue.newBuilder()
                    .setJson("{}")
                    .build());

            if (assetDTO.siteId() != null) {
                assetBuilder.setSiteId(com.heatingplatform.core.proto.v1.UUID.newBuilder()
                    .setValue(assetDTO.siteId().toString())
                    .build());
            }

            Asset asset = assetBuilder.build();
            
            GetAssetResponse response = GetAssetResponse.newBuilder()
                .setAsset(asset)
                .build();
            
            responseObserver.onNext(response);
            responseObserver.onCompleted();
        } catch (io.grpc.StatusRuntimeException e) {
            responseObserver.onError(e);
        } catch (Exception e) {
            log.error("Error in getAsset", e);
            responseObserver.onError(io.grpc.Status.INTERNAL
                .withDescription(e.getMessage())
                .asRuntimeException());
        }
    }
    
    // Measurement reads moved to the analytics service (resolve-then-fetch):
    // the former getMeasurements/getLatestMeasurements RPCs are no longer
    // implemented — the BFF composes channels (REST) with analytics series.

    @Override
    public void relocateAsset(RelocateAssetRequest request, StreamObserver<RelocateAssetResponse> responseObserver) {
        try {
            log.info("gRPC RelocateAsset called for asset: {} to site: {}", 
                request.getAssetId().getValue(), request.getTargetSiteId().getValue());
            
            java.util.UUID assetId = java.util.UUID.fromString(request.getAssetId().getValue());
            java.util.UUID targetSiteId = java.util.UUID.fromString(request.getTargetSiteId().getValue());
            java.util.UUID targetSpaceId = request.hasTargetSpaceId() && !request.getTargetSpaceId().getValue().isEmpty()
                ? java.util.UUID.fromString(request.getTargetSpaceId().getValue())
                : null;
            
            AssetDTO relocated = assetService.relocateAsset(assetId, targetSiteId, targetSpaceId);
            
            // device_id, type, model_human, signal_map were removed from assets in V12.
            Asset.Builder assetBuilder = Asset.newBuilder()
                .setId(com.heatingplatform.core.proto.v1.UUID.newBuilder()
                    .setValue(relocated.id().toString()).build())
                .setDeviceId("")
                .setName(relocated.name())
                .setType("")
                .setModelHuman("")
                .setSignalMap(JsonValue.newBuilder()
                    .setJson("{}")
                    .build());

            if (relocated.siteId() != null) {
                assetBuilder.setSiteId(com.heatingplatform.core.proto.v1.UUID.newBuilder()
                    .setValue(relocated.siteId().toString()).build());
            }
            if (relocated.spaceId() != null) {
                assetBuilder.setSpaceId(com.heatingplatform.core.proto.v1.UUID.newBuilder()
                    .setValue(relocated.spaceId().toString()).build());
            }
            
            RelocateAssetResponse response = RelocateAssetResponse.newBuilder()
                .setAsset(assetBuilder.build())
                .build();
            
            responseObserver.onNext(response);
            responseObserver.onCompleted();
        } catch (io.grpc.StatusRuntimeException e) {
            responseObserver.onError(e);
        } catch (com.heatingplatform.core.common.exception.ResourceNotFoundException e) {
            responseObserver.onError(io.grpc.Status.NOT_FOUND
                .withDescription(e.getMessage())
                .asRuntimeException());
        } catch (com.heatingplatform.core.common.exception.ValidationException e) {
            responseObserver.onError(io.grpc.Status.INVALID_ARGUMENT
                .withDescription(e.getMessage())
                .asRuntimeException());
        } catch (Exception e) {
            log.error("Error in relocateAsset", e);
            responseObserver.onError(io.grpc.Status.INTERNAL
                .withDescription(e.getMessage())
                .asRuntimeException());
        }
    }
    
}
