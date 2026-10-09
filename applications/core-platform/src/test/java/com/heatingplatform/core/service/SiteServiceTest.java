package com.heatingplatform.core.service;

import com.heatingplatform.core.ontology.OntologyService;
import com.heatingplatform.core.site.SiteService;

import com.heatingplatform.core.site.SiteDTO;
import com.heatingplatform.core.ontology.ObjectEntity;
import com.heatingplatform.core.tenant.Tenant;
import com.heatingplatform.core.common.exception.DuplicateResourceException;
import com.heatingplatform.core.common.exception.ResourceNotFoundException;
import com.heatingplatform.core.common.exception.ValidationException;
import com.heatingplatform.core.ontology.ObjectRepository;
import com.heatingplatform.core.tenant.TenantRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

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
class SiteServiceTest {

    @Mock
    private ObjectRepository objectRepository;

    @Mock
    private TenantRepository tenantRepository;

    @Mock
    private OntologyService ontologyService;

    @InjectMocks
    private SiteService siteService;

    @Test
    void getAllSites_ShouldReturnDTOList() {
        UUID siteId = UUID.randomUUID();
        ObjectEntity obj = new ObjectEntity();
        obj.setId(siteId);
        obj.setDisplayName("Test Site");
        obj.setProperties("{\"address\":\"{\\\"street\\\":\\\"123 Main St\\\"}\"}");

        given(objectRepository.findByObjectTypeName(OntologyService.BUILDING)).willReturn(List.of(obj));
        given(ontologyService.countByTargetAndType(siteId, OntologyService.INSTALLED_AT)).willReturn(3);

        List<SiteDTO> result = siteService.getAllSites();

        assertThat(result).hasSize(1);
        assertThat(result.get(0).name()).isEqualTo("Test Site");
        assertThat(result.get(0).assetCount()).isEqualTo(3);
    }

    @Test
    void getSiteById_WhenExists_ReturnsSite() {
        UUID siteId = UUID.randomUUID();
        ObjectEntity obj = new ObjectEntity();
        obj.setId(siteId);
        obj.setDisplayName("Test Site");

        given(objectRepository.findById(siteId)).willReturn(Optional.of(obj));

        Optional<ObjectEntity> result = siteService.getSiteById(siteId);

        assertThat(result).isPresent();
        assertThat(result.get().getDisplayName()).isEqualTo("Test Site");
        verify(objectRepository).findById(siteId);
    }

    @Test
    void getSiteById_WhenNotExists_ReturnsEmpty() {
        UUID siteId = UUID.randomUUID();
        given(objectRepository.findById(siteId)).willReturn(Optional.empty());

        Optional<ObjectEntity> result = siteService.getSiteById(siteId);

        assertThat(result).isEmpty();
    }

    @Test
    void createSite_Success() {
        UUID tenantId = UUID.randomUUID();
        UUID siteId = UUID.randomUUID();
        Tenant tenant = new Tenant();
        tenant.setId(tenantId);
        tenant.setName("Test Tenant");

        ObjectEntity savedObj = new ObjectEntity();
        savedObj.setId(siteId);
        savedObj.setDisplayName("New Site");
        savedObj.setTenant(tenant);
        savedObj.setProperties("{\"address\":{\"street\":\"456 Oak Ave\"}}");

        given(tenantRepository.findById(tenantId)).willReturn(Optional.of(tenant));
        given(objectRepository.findByDisplayName("New Site")).willReturn(Optional.empty());
        given(ontologyService.registerObject(any(UUID.class), eq(OntologyService.BUILDING),
                eq(tenantId), eq("New Site"), any(String.class))).willReturn(savedObj);

        ObjectEntity result = siteService.createSite(tenantId, "New Site", "{\"street\":\"456 Oak Ave\"}", null);

        assertThat(result.getDisplayName()).isEqualTo("New Site");
        assertThat(result.getTenant()).isEqualTo(tenant);
        verify(ontologyService).registerObject(any(UUID.class), eq(OntologyService.BUILDING),
                eq(tenantId), eq("New Site"), any(String.class));
    }

    @Test
    void createSite_WithMetadata() {
        UUID tenantId = UUID.randomUUID();
        UUID siteId = UUID.randomUUID();
        Tenant tenant = new Tenant();
        tenant.setId(tenantId);

        ObjectEntity savedObj = new ObjectEntity();
        savedObj.setId(siteId);
        savedObj.setDisplayName("Site With Meta");
        savedObj.setProperties("{\"address\":{},\"attributes\":{\"key\":\"value\"}}");

        given(tenantRepository.findById(tenantId)).willReturn(Optional.of(tenant));
        given(objectRepository.findByDisplayName("Site With Meta")).willReturn(Optional.empty());
        given(ontologyService.registerObject(any(UUID.class), eq(OntologyService.BUILDING),
                eq(tenantId), eq("Site With Meta"), any(String.class))).willReturn(savedObj);

        ObjectEntity result = siteService.createSite(tenantId, "Site With Meta", "{}", "{\"key\":\"value\"}");

        assertThat(result.getProperties()).contains("attributes");
    }

    @Test
    void createSite_EmptyName_ThrowsValidation() {
        UUID tenantId = UUID.randomUUID();

        assertThatThrownBy(() -> siteService.createSite(tenantId, "", "{}", null))
            .isInstanceOf(ValidationException.class)
            .hasMessageContaining("name must not be empty");

        verify(ontologyService, never()).registerObject(any(), any(), any(), any(), any());
    }

    @Test
    void createSite_NullAddress_ThrowsValidation() {
        UUID tenantId = UUID.randomUUID();

        assertThatThrownBy(() -> siteService.createSite(tenantId, "Site", null, null))
            .isInstanceOf(ValidationException.class)
            .hasMessageContaining("address must not be empty");

        verify(ontologyService, never()).registerObject(any(), any(), any(), any(), any());
    }

    @Test
    void createSite_TenantNotFound_ThrowsNotFound() {
        UUID tenantId = UUID.randomUUID();
        given(tenantRepository.findById(tenantId)).willReturn(Optional.empty());

        assertThatThrownBy(() -> siteService.createSite(tenantId, "Site", "{}", null))
            .isInstanceOf(ResourceNotFoundException.class)
            .hasMessageContaining("Tenant not found");

        verify(ontologyService, never()).registerObject(any(), any(), any(), any(), any());
    }

    @Test
    void createSite_DuplicateName_ThrowsDuplicate() {
        UUID tenantId = UUID.randomUUID();
        Tenant tenant = new Tenant();
        tenant.setId(tenantId);

        given(tenantRepository.findById(tenantId)).willReturn(Optional.of(tenant));
        given(objectRepository.findByDisplayName("Existing Site")).willReturn(Optional.of(new ObjectEntity()));

        assertThatThrownBy(() -> siteService.createSite(tenantId, "Existing Site", "{}", null))
            .isInstanceOf(DuplicateResourceException.class)
            .hasMessageContaining("Site already exists");

        verify(ontologyService, never()).registerObject(any(), any(), any(), any(), any());
    }
}
