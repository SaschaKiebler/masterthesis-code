package com.heatingplatform.core.gateway;

import com.heatingplatform.core.tenancy.TenantBodyGuard;
import com.heatingplatform.core.common.RestGateway;

import com.heatingplatform.core.site.SiteDTO;
import com.heatingplatform.core.proto.v1.AssetServiceGrpc;
import com.heatingplatform.core.ontology.ObjectRepository;
import com.heatingplatform.core.asset.AssetService;
import com.heatingplatform.core.user.AuthService;
import com.heatingplatform.core.site.SiteService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class RestGatewaySiteScopingTest {

    @Mock
    private AssetServiceGrpc.AssetServiceBlockingStub assetServiceStub;

    @Mock
    private AuthService authService;

    @Mock
    private SiteService siteService;

    @Mock
    private AssetService assetService;

    @Mock
    private ObjectRepository objectRepository;

    @Mock
    private TenantBodyGuard tenantBodyGuard;

    private RestGateway restGateway;

    private SiteDTO site1;
    private SiteDTO site2;
    private SiteDTO site3;

    @BeforeEach
    void setUp() {
        restGateway = new RestGateway(assetServiceStub, authService, siteService, assetService, objectRepository, tenantBodyGuard);

        site1 = new SiteDTO(UUID.randomUUID(), "Site Alpha", "{}", 5);
        site2 = new SiteDTO(UUID.randomUUID(), "Site Beta", "{}", 3);
        site3 = new SiteDTO(UUID.randomUUID(), "Site Gamma", "{}", 0);
    }

    @Nested
    class WithExplicitTenantFilter {

        @Test
        void shouldReturnTenantSitesWhenUserHasAccess() {
            UUID tenantId = UUID.randomUUID();
            given(authService.canAccessTenant(tenantId)).willReturn(true);
            given(siteService.getSitesByTenant(tenantId)).willReturn(List.of(site1, site2));

            ResponseEntity<Map<String, Object>> response =
                    restGateway.listSites(1, 100, tenantId.toString());

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> sites = (List<Map<String, Object>>) response.getBody().get("sites");
            assertThat(sites).hasSize(2);
            assertThat(sites.get(0).get("name")).isEqualTo("Site Alpha");
        }

        @Test
        void shouldReturn403WhenUserCannotAccessTenant() {
            UUID tenantId = UUID.randomUUID();
            given(authService.canAccessTenant(tenantId)).willReturn(false);

            ResponseEntity<Map<String, Object>> response =
                    restGateway.listSites(1, 100, tenantId.toString());

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
            verify(siteService, never()).getSitesByTenant(any());
        }
    }

    @Nested
    class WithoutTenantFilter {

        @Test
        void systemAdmin_ShouldReturnAllSites() {
            given(authService.isSystemAdmin()).willReturn(true);
            given(siteService.getAllSites()).willReturn(List.of(site1, site2, site3));

            ResponseEntity<Map<String, Object>> response =
                    restGateway.listSites(1, 100, null);

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> sites = (List<Map<String, Object>>) response.getBody().get("sites");
            assertThat(sites).hasSize(3);
        }

        @Test
        void regularUser_ShouldReturnOnlyAccessibleSites() {
            given(authService.isSystemAdmin()).willReturn(false);
            List<UUID> accessibleIds = List.of(site1.id(), site2.id());
            given(authService.getAccessibleSiteIds()).willReturn(accessibleIds);
            given(siteService.getSitesBySiteIds(accessibleIds)).willReturn(List.of(site1, site2));

            ResponseEntity<Map<String, Object>> response =
                    restGateway.listSites(1, 100, null);

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> sites = (List<Map<String, Object>>) response.getBody().get("sites");
            assertThat(sites).hasSize(2);
            verify(siteService, never()).getAllSites();
        }

        @Test
        void regularUser_WithNullAccessibleSites_ShouldReturnAll() {
            // null signals "no filter" (system admin fallback)
            given(authService.isSystemAdmin()).willReturn(false);
            given(authService.getAccessibleSiteIds()).willReturn(null);
            given(siteService.getAllSites()).willReturn(List.of(site1, site2, site3));

            ResponseEntity<Map<String, Object>> response =
                    restGateway.listSites(1, 100, null);

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> sites = (List<Map<String, Object>>) response.getBody().get("sites");
            assertThat(sites).hasSize(3);
        }

        @Test
        void regularUser_WithEmptyAccessibleSites_ShouldReturnEmpty() {
            given(authService.isSystemAdmin()).willReturn(false);
            given(authService.getAccessibleSiteIds()).willReturn(List.of());
            given(siteService.getSitesBySiteIds(List.of())).willReturn(List.of());

            ResponseEntity<Map<String, Object>> response =
                    restGateway.listSites(1, 100, null);

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> sites = (List<Map<String, Object>>) response.getBody().get("sites");
            assertThat(sites).isEmpty();
        }
    }

    @Nested
    class ResponseFormat {

        @Test
        void shouldReturnCorrectSiteMapFields() {
            given(authService.isSystemAdmin()).willReturn(true);
            given(siteService.getAllSites()).willReturn(List.of(site1));

            ResponseEntity<Map<String, Object>> response =
                    restGateway.listSites(1, 100, null);

            @SuppressWarnings("unchecked")
            List<Map<String, Object>> sites = (List<Map<String, Object>>) response.getBody().get("sites");
            Map<String, Object> siteMap = sites.get(0);

            assertThat(siteMap).containsKeys("id", "name", "address", "assetCount");
            assertThat(siteMap.get("id")).isEqualTo(site1.id().toString());
            assertThat(siteMap.get("name")).isEqualTo("Site Alpha");
            assertThat(siteMap.get("assetCount")).isEqualTo(5);
        }

        @Test
        void shouldReturnPageInfo() {
            given(authService.isSystemAdmin()).willReturn(true);
            given(siteService.getAllSites()).willReturn(List.of(site1, site2));

            ResponseEntity<Map<String, Object>> response =
                    restGateway.listSites(1, 100, null);

            @SuppressWarnings("unchecked")
            Map<String, Object> page = (Map<String, Object>) response.getBody().get("page");
            assertThat(page.get("totalItems")).isEqualTo(2);
        }
    }
}
