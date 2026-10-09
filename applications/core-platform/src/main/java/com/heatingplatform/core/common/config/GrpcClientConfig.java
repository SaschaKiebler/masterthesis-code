package com.heatingplatform.core.common.config;

import com.heatingplatform.core.proto.v1.AssetServiceGrpc;
import com.heatingplatform.core.proto.v1.SiteServiceGrpc;
import io.grpc.ManagedChannel;
import io.grpc.ManagedChannelBuilder;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Configuration for gRPC client stubs used by the REST gateway.
 * These stubs connect to the local gRPC server to call services internally.
 */
@Configuration
public class GrpcClientConfig {
    
    @Value("${grpc.server.port:9090}")
    private int grpcPort;
    
    @Bean
    public ManagedChannel grpcChannel() {
        return ManagedChannelBuilder
            .forAddress("localhost", grpcPort)
            .usePlaintext()
            .maxInboundMessageSize(100 * 1024 * 1024) // 100 MB
            .build();
    }
    
    @Bean
    public SiteServiceGrpc.SiteServiceBlockingStub siteServiceStub(ManagedChannel channel) {
        return SiteServiceGrpc.newBlockingStub(channel);
    }
    
    @Bean
    public AssetServiceGrpc.AssetServiceBlockingStub assetServiceStub(ManagedChannel channel) {
        return AssetServiceGrpc.newBlockingStub(channel);
    }
}
