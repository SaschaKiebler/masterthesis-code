package com.digitaldemon.core.service;

import com.digitaldemon.core.ontology.OntologyService;

import com.digitaldemon.core.ontology.Link;
import com.digitaldemon.core.ontology.LinkType;
import com.digitaldemon.core.ontology.ObjectEntity;
import com.digitaldemon.core.ontology.ObjectType;
import com.digitaldemon.core.tenant.Tenant;
import com.digitaldemon.core.common.exception.ResourceNotFoundException;
import com.digitaldemon.core.common.exception.ServiceException;
import com.digitaldemon.core.ontology.LinkRepository;
import com.digitaldemon.core.ontology.LinkTypeRepository;
import com.digitaldemon.core.ontology.ObjectRepository;
import com.digitaldemon.core.ontology.ObjectTypeRepository;
import com.digitaldemon.core.tenant.TenantRepository;
import org.junit.jupiter.api.BeforeEach;
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
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class OntologyServiceTest {

    @Mock private ObjectRepository objectRepository;
    @Mock private LinkTypeRepository linkTypeRepository;
    @Mock private LinkRepository linkRepository;
    @Mock private ObjectTypeRepository objectTypeRepository;
    @Mock private TenantRepository tenantRepository;

    @InjectMocks
    private OntologyService ontologyService;

    private UUID objectId;
    private UUID tenantId;
    private UUID sourceId;
    private UUID targetId;
    private UUID objectTypeUuid;
    private UUID linkTypeUuid;
    private ObjectType objectType;
    private Tenant tenant;
    private LinkType linkType;

    @BeforeEach
    void setUp() {
        objectId      = UUID.randomUUID();
        tenantId      = UUID.randomUUID();
        sourceId      = UUID.randomUUID();
        targetId      = UUID.randomUUID();
        objectTypeUuid = UUID.randomUUID();
        linkTypeUuid   = UUID.randomUUID();

        objectType = new ObjectType();
        objectType.setId(objectTypeUuid);
        objectType.setName(OntologyService.BUILDING);

        tenant = new Tenant();
        tenant.setId(tenantId);

        linkType = new LinkType();
        linkType.setId(linkTypeUuid);
        linkType.setName(OntologyService.CONTAINS);
    }

    // =========================================================================
    // registerObject
    // =========================================================================

    @Test
    void registerObject_WhenValidInput_SavesObjectWithCorrectFields() {
        when(objectTypeRepository.findSystemTypeByName(OntologyService.BUILDING)).thenReturn(Optional.of(objectType));
        when(tenantRepository.getReferenceById(tenantId)).thenReturn(tenant);
        ObjectEntity saved = new ObjectEntity();
        saved.setId(objectId);
        when(objectRepository.save(any())).thenReturn(saved);

        ObjectEntity result = ontologyService.registerObject(objectId, OntologyService.BUILDING, tenantId, "Test Building");

        ArgumentCaptor<ObjectEntity> captor = ArgumentCaptor.forClass(ObjectEntity.class);
        verify(objectRepository).save(captor.capture());
        ObjectEntity captured = captor.getValue();
        assertThat(captured.getId()).isEqualTo(objectId);
        assertThat(captured.getObjectType()).isEqualTo(objectType);
        assertThat(captured.getTenant()).isEqualTo(tenant);
        assertThat(captured.getDisplayName()).isEqualTo("Test Building");
        assertThat(captured.getCreatedAt()).isNotNull();
        assertThat(captured.getUpdatedAt()).isNotNull();
        assertThat(result).isEqualTo(saved);
    }

    @Test
    void registerObject_WhenTypeNotInDB_ThrowsServiceException() {
        when(objectTypeRepository.findSystemTypeByName("NONEXISTENT")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> ontologyService.registerObject(objectId, "NONEXISTENT", tenantId, "Bad"))
                .isInstanceOf(ServiceException.class)
                .hasMessageContaining("Unknown object type: NONEXISTENT");
    }

    @Test
    void registerObject_WhenTenantIdIsNull_SavesObjectWithNullTenant() {
        when(objectTypeRepository.findSystemTypeByName(OntologyService.BUILDING)).thenReturn(Optional.of(objectType));
        ObjectEntity saved = new ObjectEntity();
        when(objectRepository.save(any())).thenReturn(saved);

        ontologyService.registerObject(objectId, OntologyService.BUILDING, null, "Orphan Building");

        ArgumentCaptor<ObjectEntity> captor = ArgumentCaptor.forClass(ObjectEntity.class);
        verify(objectRepository).save(captor.capture());
        assertThat(captor.getValue().getTenant()).isNull();
        verify(tenantRepository, never()).getReferenceById(any());
    }

    @Test
    void registerObject_TypeResolution_UsesCacheOnSecondCall() {
        when(objectTypeRepository.findSystemTypeByName(OntologyService.BUILDING)).thenReturn(Optional.of(objectType));
        when(objectRepository.save(any())).thenReturn(new ObjectEntity());

        ontologyService.registerObject(UUID.randomUUID(), OntologyService.BUILDING, null, "First");
        ontologyService.registerObject(UUID.randomUUID(), OntologyService.BUILDING, null, "Second");

        verify(objectTypeRepository, times(1)).findSystemTypeByName(OntologyService.BUILDING);
    }

    // =========================================================================
    // updateDisplayName
    // =========================================================================

    @Test
    void updateDisplayName_WhenObjectExists_UpdatesName() {
        ObjectEntity existing = new ObjectEntity();
        existing.setId(objectId);
        existing.setDisplayName("Old Name");
        when(objectRepository.findById(objectId)).thenReturn(Optional.of(existing));
        when(objectRepository.save(any())).thenReturn(existing);

        ontologyService.updateDisplayName(objectId, "New Name");

        ArgumentCaptor<ObjectEntity> captor = ArgumentCaptor.forClass(ObjectEntity.class);
        verify(objectRepository).save(captor.capture());
        assertThat(captor.getValue().getDisplayName()).isEqualTo("New Name");
        assertThat(captor.getValue().getUpdatedAt()).isNotNull();
    }

    @Test
    void updateDisplayName_WhenObjectNotFound_DoesNothing() {
        when(objectRepository.findById(objectId)).thenReturn(Optional.empty());

        ontologyService.updateDisplayName(objectId, "New Name");

        verify(objectRepository, never()).save(any());
    }

    // =========================================================================
    // upsertLink
    // =========================================================================

    @Test
    void upsertLink_WhenLinkDoesNotExist_CreatesLink() {
        when(linkTypeRepository.findByName(OntologyService.CONTAINS)).thenReturn(Optional.of(linkType));
        when(linkRepository.existsBySourceTargetAndType(sourceId, targetId, linkTypeUuid)).thenReturn(false);
        ObjectEntity sourceObj = new ObjectEntity();
        sourceObj.setId(sourceId);
        ObjectEntity targetObj = new ObjectEntity();
        targetObj.setId(targetId);
        when(objectRepository.getReferenceById(sourceId)).thenReturn(sourceObj);
        when(objectRepository.getReferenceById(targetId)).thenReturn(targetObj);
        when(linkRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        ontologyService.upsertLink(sourceId, targetId, OntologyService.CONTAINS);

        ArgumentCaptor<Link> captor = ArgumentCaptor.forClass(Link.class);
        verify(linkRepository).save(captor.capture());
        Link link = captor.getValue();
        assertThat(link.getLinkType()).isEqualTo(linkType);
        assertThat(link.getSource()).isEqualTo(sourceObj);
        assertThat(link.getTarget()).isEqualTo(targetObj);
        assertThat(link.getProperties()).isEqualTo("{}");
        assertThat(link.getCreatedAt()).isNotNull();
    }

    @Test
    void upsertLink_WhenLinkAlreadyExists_DoesNotCreateDuplicate() {
        when(linkTypeRepository.findByName(OntologyService.CONTAINS)).thenReturn(Optional.of(linkType));
        when(linkRepository.existsBySourceTargetAndType(sourceId, targetId, linkTypeUuid)).thenReturn(true);

        ontologyService.upsertLink(sourceId, targetId, OntologyService.CONTAINS);

        verify(linkRepository, never()).save(any());
        verify(objectRepository, never()).getReferenceById(any());
    }

    @Test
    void upsertLink_WhenLinkTypeNotInDB_ThrowsServiceException() {
        when(linkTypeRepository.findByName("NONEXISTENT")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> ontologyService.upsertLink(sourceId, targetId, "NONEXISTENT"))
                .isInstanceOf(ServiceException.class)
                .hasMessageContaining("Unknown link type: NONEXISTENT");
    }

    // =========================================================================
    // deleteOutboundLinksOfType / deleteInboundLinksOfType
    // =========================================================================

    @Test
    void deleteOutboundLinksOfType_ResolvesTypeAndDelegatesToRepository() {
        LinkType installedAt = new LinkType();
        UUID installedAtId = UUID.randomUUID();
        installedAt.setId(installedAtId);
        installedAt.setName(OntologyService.INSTALLED_AT);
        when(linkTypeRepository.findByName(OntologyService.INSTALLED_AT)).thenReturn(Optional.of(installedAt));

        ontologyService.deleteOutboundLinksOfType(sourceId, OntologyService.INSTALLED_AT);

        verify(linkRepository).deleteBySourceAndLinkType(sourceId, installedAtId);
    }

    @Test
    void deleteInboundLinksOfType_ResolvesTypeAndDelegatesToRepository() {
        when(linkTypeRepository.findByName(OntologyService.CONTAINS)).thenReturn(Optional.of(linkType));

        ontologyService.deleteInboundLinksOfType(targetId, OntologyService.CONTAINS);

        verify(linkRepository).deleteByTargetAndLinkType(targetId, linkTypeUuid);
    }

    // =========================================================================
    // replaceContainsParent
    // =========================================================================

    @Test
    void replaceContainsParent_DeletesOldInboundAndCreatesNew() {
        UUID newSourceId = UUID.randomUUID();
        when(linkTypeRepository.findByName(OntologyService.CONTAINS)).thenReturn(Optional.of(linkType));
        when(linkRepository.existsBySourceTargetAndType(newSourceId, objectId, linkTypeUuid)).thenReturn(false);
        ObjectEntity newSource = new ObjectEntity();
        newSource.setId(newSourceId);
        ObjectEntity target = new ObjectEntity();
        target.setId(objectId);
        when(objectRepository.getReferenceById(newSourceId)).thenReturn(newSource);
        when(objectRepository.getReferenceById(objectId)).thenReturn(target);
        when(linkRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        ontologyService.replaceContainsParent(objectId, newSourceId);

        verify(linkRepository).deleteByTargetAndLinkType(objectId, linkTypeUuid);
        verify(linkRepository).save(any(Link.class));
    }

    // =========================================================================
    // getOutboundNeighbors / getInboundNeighbors
    // =========================================================================

    @Test
    void getOutboundNeighbors_ReturnsTargetObjects() {
        when(linkTypeRepository.findByName(OntologyService.CONTAINS)).thenReturn(Optional.of(linkType));
        ObjectEntity targetObj = new ObjectEntity();
        targetObj.setId(targetId);
        Link link = new Link();
        link.setTarget(targetObj);
        when(linkRepository.findBySourceAndLinkType(sourceId, linkTypeUuid)).thenReturn(List.of(link));

        List<ObjectEntity> neighbors = ontologyService.getOutboundNeighbors(sourceId, OntologyService.CONTAINS);

        assertThat(neighbors).hasSize(1);
        assertThat(neighbors.get(0).getId()).isEqualTo(targetId);
    }

    @Test
    void getInboundNeighbors_ReturnsSourceObjects() {
        LinkType installedIn = new LinkType();
        UUID installedInId = UUID.randomUUID();
        installedIn.setId(installedInId);
        installedIn.setName(OntologyService.INSTALLED_IN);
        when(linkTypeRepository.findByName(OntologyService.INSTALLED_IN)).thenReturn(Optional.of(installedIn));
        ObjectEntity sourceObj = new ObjectEntity();
        sourceObj.setId(sourceId);
        Link link = new Link();
        link.setSource(sourceObj);
        when(linkRepository.findByTargetAndLinkType(targetId, installedInId)).thenReturn(List.of(link));

        List<ObjectEntity> neighbors = ontologyService.getInboundNeighbors(targetId, OntologyService.INSTALLED_IN);

        assertThat(neighbors).hasSize(1);
        assertThat(neighbors.get(0).getId()).isEqualTo(sourceId);
    }

    // =========================================================================
    // getObject
    // =========================================================================

    @Test
    void getObject_WhenFound_ReturnsObject() {
        ObjectEntity obj = new ObjectEntity();
        obj.setId(objectId);
        when(objectRepository.findById(objectId)).thenReturn(Optional.of(obj));

        ObjectEntity result = ontologyService.getObject(objectId);

        assertThat(result.getId()).isEqualTo(objectId);
    }

    @Test
    void getObject_WhenNotFound_ThrowsResourceNotFoundException() {
        when(objectRepository.findById(objectId)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> ontologyService.getObject(objectId))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    // =========================================================================
    // Type name helpers (static — no DB access needed)
    // =========================================================================

    @Test
    void spaceTypeName_ReturnsSpaceTypeDirectly() {
        assertThat(OntologyService.spaceTypeName("FLOOR")).isEqualTo("FLOOR");
        assertThat(OntologyService.spaceTypeName("APARTMENT")).isEqualTo("APARTMENT");
        assertThat(OntologyService.spaceTypeName("ROOM")).isEqualTo("ROOM");
        assertThat(OntologyService.spaceTypeName("BASEMENT")).isEqualTo("BASEMENT");
        assertThat(OntologyService.spaceTypeName("COMMON_AREA")).isEqualTo("COMMON_AREA");
        assertThat(OntologyService.spaceTypeName("TECHNICAL_ROOM")).isEqualTo("TECHNICAL_ROOM");
    }

    @Test
    void assetTypeName_TranslatesLegacyAssetTypes() {
        assertThat(OntologyService.assetTypeName("SENSOR")).isEqualTo(OntologyService.GENERIC_SENSOR);
        assertThat(OntologyService.assetTypeName("ACTUATOR")).isEqualTo(OntologyService.ACTUATOR);
        assertThat(OntologyService.assetTypeName("CONTROLLER")).isEqualTo(OntologyService.CONTROLLER);
        assertThat(OntologyService.assetTypeName("GATEWAY")).isEqualTo(OntologyService.GATEWAY);
        assertThat(OntologyService.assetTypeName("HEATER")).isEqualTo(OntologyService.BOILER);
        assertThat(OntologyService.assetTypeName("PUMP")).isEqualTo(OntologyService.PUMP);
        assertThat(OntologyService.assetTypeName("UNKNOWN")).isEqualTo(OntologyService.GENERIC_SENSOR);
    }
}
