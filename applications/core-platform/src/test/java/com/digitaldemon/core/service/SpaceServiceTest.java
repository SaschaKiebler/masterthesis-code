package com.digitaldemon.core.service;

import com.digitaldemon.core.ontology.OntologyService;
import com.digitaldemon.core.space.SpaceService;

import com.digitaldemon.core.space.SpaceDTO;
import com.digitaldemon.core.ontology.ObjectEntity;
import com.digitaldemon.core.ontology.ObjectType;
import com.digitaldemon.core.common.exception.ResourceNotFoundException;
import com.digitaldemon.core.common.exception.ValidationException;
import com.digitaldemon.core.ontology.ObjectRepository;
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
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class SpaceServiceTest {

    @Mock
    private ObjectRepository objectRepository;

    @Mock
    private OntologyService ontologyService;

    @InjectMocks
    private SpaceService spaceService;

    // --- Helper methods ---

    private ObjectEntity makeObjectEntity(UUID id, String typeName, String displayName) {
        ObjectType ot = new ObjectType();
        ot.setName(typeName);
        ObjectEntity obj = new ObjectEntity();
        obj.setId(id);
        obj.setObjectType(ot);
        obj.setDisplayName(displayName);
        obj.setProperties("{}");
        return obj;
    }

    private ObjectEntity makeSiteObject(UUID id) {
        ObjectType buildingType = new ObjectType();
        buildingType.setName("BUILDING");
        ObjectEntity obj = new ObjectEntity();
        obj.setId(id);
        obj.setObjectType(buildingType);
        obj.setDisplayName("Test Site");
        obj.setProperties("{}");
        return obj;
    }

    // --- getSpacesBySite ---

    @Test
    void getSpacesBySite_ReturnsFlatList() {
        UUID siteId = UUID.randomUUID();
        UUID spaceId = UUID.randomUUID();
        ObjectEntity spaceObj = makeObjectEntity(spaceId, "APARTMENT", "Apt 1A");

        given(ontologyService.getOutboundNeighbors(siteId, OntologyService.CONTAINS)).willReturn(List.of(spaceObj));
        given(ontologyService.getOutboundNeighbors(spaceId, OntologyService.CONTAINS)).willReturn(List.of());
        given(objectRepository.findAllWithTypeByIdIn(List.of(spaceId))).willReturn(List.of(spaceObj));
        given(ontologyService.resolveSourceId(spaceId, OntologyService.CONTAINS)).willReturn(siteId);
        given(ontologyService.getObject(siteId)).willReturn(makeSiteObject(siteId));

        List<SpaceDTO> result = spaceService.getSpacesBySite(siteId);

        assertThat(result).hasSize(1);
        assertThat(result.get(0).id()).isEqualTo(spaceId);
        assertThat(result.get(0).name()).isEqualTo("Apt 1A");
        assertThat(result.get(0).type()).isEqualTo("APARTMENT");
        assertThat(result.get(0).children()).isEmpty();
    }

    @Test
    void getSpacesBySite_EmptySite_ReturnsEmptyList() {
        UUID siteId = UUID.randomUUID();
        given(ontologyService.getOutboundNeighbors(siteId, OntologyService.CONTAINS)).willReturn(List.of());

        List<SpaceDTO> result = spaceService.getSpacesBySite(siteId);

        assertThat(result).isEmpty();
    }

    // --- getSpaceTree ---

    @Test
    void getSpaceTree_EmptySite_ReturnsEmptyList() {
        UUID siteId = UUID.randomUUID();
        given(ontologyService.getOutboundNeighbors(siteId, OntologyService.CONTAINS)).willReturn(List.of());

        List<SpaceDTO> result = spaceService.getSpaceTree(siteId);

        assertThat(result).isEmpty();
    }

    // --- getSpaceById ---

    @Test
    void getSpaceById_WhenExists_ReturnsDTO() {
        UUID spaceId = UUID.randomUUID();
        UUID siteId = UUID.randomUUID();
        ObjectEntity spaceObj = makeObjectEntity(spaceId, "ROOM", "Kitchen");

        given(objectRepository.findById(spaceId)).willReturn(Optional.of(spaceObj));
        given(ontologyService.resolveSourceId(spaceId, OntologyService.CONTAINS)).willReturn(siteId);
        given(ontologyService.getObject(siteId)).willReturn(makeSiteObject(siteId));

        Optional<SpaceDTO> result = spaceService.getSpaceById(spaceId);

        assertThat(result).isPresent();
        assertThat(result.get().name()).isEqualTo("Kitchen");
    }

    @Test
    void getSpaceById_WhenNotExists_ReturnsEmpty() {
        UUID spaceId = UUID.randomUUID();
        given(objectRepository.findById(spaceId)).willReturn(Optional.empty());

        Optional<SpaceDTO> result = spaceService.getSpaceById(spaceId);

        assertThat(result).isEmpty();
    }

    // --- createSpace ---

    @Test
    void createSpace_Success_RootSpace() {
        UUID siteId = UUID.randomUUID();
        UUID spaceId = UUID.randomUUID();
        ObjectEntity site = makeSiteObject(siteId);
        ObjectEntity savedSpace = makeObjectEntity(spaceId, "FLOOR", "Ground Floor");

        given(objectRepository.findById(siteId)).willReturn(Optional.of(site));
        given(ontologyService.registerObject(any(UUID.class), eq("FLOOR"), any(), eq("Ground Floor"), any(String.class)))
            .willReturn(savedSpace);
        given(ontologyService.resolveSourceId(spaceId, OntologyService.CONTAINS)).willReturn(siteId);
        given(ontologyService.getObject(siteId)).willReturn(site);

        SpaceDTO result = spaceService.createSpace(siteId,
            new SpaceService.CreateSpaceRequest("FLOOR", "Ground Floor", null, null));

        assertThat(result.name()).isEqualTo("Ground Floor");
        assertThat(result.type()).isEqualTo("FLOOR");
        verify(ontologyService).registerObject(any(UUID.class), eq("FLOOR"), any(), eq("Ground Floor"), any(String.class));
        verify(ontologyService).upsertLink(eq(siteId), any(), eq(OntologyService.CONTAINS));
    }

    @Test
    void createSpace_Success_ChildSpace() {
        UUID siteId = UUID.randomUUID();
        UUID parentId = UUID.randomUUID();
        UUID spaceId = UUID.randomUUID();
        ObjectEntity site = makeSiteObject(siteId);
        ObjectEntity savedSpace = makeObjectEntity(spaceId, "APARTMENT", "Apt 1A");
        ObjectEntity parentObj = makeObjectEntity(parentId, "FLOOR", "Ground Floor");

        given(objectRepository.findById(siteId)).willReturn(Optional.of(site));
        given(objectRepository.existsById(parentId)).willReturn(true);
        // parent belongs to the same site
        given(ontologyService.resolveSourceId(parentId, OntologyService.CONTAINS)).willReturn(siteId);
        given(ontologyService.getObject(siteId)).willReturn(site);
        given(ontologyService.registerObject(any(UUID.class), eq("APARTMENT"), any(), eq("Apt 1A"), any(String.class)))
            .willReturn(savedSpace);
        // toFlatDTO for the saved space
        given(ontologyService.resolveSourceId(spaceId, OntologyService.CONTAINS)).willReturn(parentId);
        given(ontologyService.getObject(parentId)).willReturn(parentObj);

        SpaceDTO result = spaceService.createSpace(siteId,
            new SpaceService.CreateSpaceRequest("APARTMENT", "Apt 1A", parentId, "{\"sqm\": 65}"));

        assertThat(result.name()).isEqualTo("Apt 1A");
        assertThat(result.type()).isEqualTo("APARTMENT");
        verify(ontologyService).upsertLink(eq(parentId), any(), eq(OntologyService.CONTAINS));
    }

    @Test
    void createSpace_SiteNotFound_ThrowsNotFound() {
        UUID siteId = UUID.randomUUID();
        given(objectRepository.findById(siteId)).willReturn(Optional.empty());

        assertThatThrownBy(() -> spaceService.createSpace(siteId,
            new SpaceService.CreateSpaceRequest("FLOOR", "Ground Floor", null, null)))
            .isInstanceOf(ResourceNotFoundException.class)
            .hasMessageContaining("Site not found");

        verify(ontologyService, never()).registerObject(any(), any(), any(), any(), any());
    }

    @Test
    void createSpace_InvalidType_ThrowsValidation() {
        UUID siteId = UUID.randomUUID();

        assertThatThrownBy(() -> spaceService.createSpace(siteId,
            new SpaceService.CreateSpaceRequest("INVALID_TYPE", "Some Space", null, null)))
            .isInstanceOf(ValidationException.class)
            .hasMessageContaining("Invalid space type");

        verify(ontologyService, never()).registerObject(any(), any(), any(), any(), any());
    }

    @Test
    void createSpace_EmptyName_ThrowsValidation() {
        UUID siteId = UUID.randomUUID();

        assertThatThrownBy(() -> spaceService.createSpace(siteId,
            new SpaceService.CreateSpaceRequest("FLOOR", "", null, null)))
            .isInstanceOf(ValidationException.class)
            .hasMessageContaining("Space name must not be empty");

        verify(ontologyService, never()).registerObject(any(), any(), any(), any(), any());
    }

    @Test
    void createSpace_ShortName_ThrowsValidation() {
        UUID siteId = UUID.randomUUID();

        assertThatThrownBy(() -> spaceService.createSpace(siteId,
            new SpaceService.CreateSpaceRequest("FLOOR", "A", null, null)))
            .isInstanceOf(ValidationException.class)
            .hasMessageContaining("at least 2 characters");

        verify(ontologyService, never()).registerObject(any(), any(), any(), any(), any());
    }

    @Test
    void createSpace_ParentNotFound_ThrowsNotFound() {
        UUID siteId = UUID.randomUUID();
        UUID fakeParent = UUID.randomUUID();

        given(objectRepository.findById(siteId)).willReturn(Optional.of(makeSiteObject(siteId)));
        given(objectRepository.existsById(fakeParent)).willReturn(false);

        assertThatThrownBy(() -> spaceService.createSpace(siteId,
            new SpaceService.CreateSpaceRequest("ROOM", "Kitchen", fakeParent, null)))
            .isInstanceOf(ResourceNotFoundException.class)
            .hasMessageContaining("Parent space not found");

        verify(ontologyService, never()).registerObject(any(), any(), any(), any(), any());
    }

    @Test
    void createSpace_ParentInDifferentSite_ThrowsValidation() {
        UUID siteId = UUID.randomUUID();
        UUID otherSiteId = UUID.randomUUID();
        UUID parentId = UUID.randomUUID();

        given(objectRepository.findById(siteId)).willReturn(Optional.of(makeSiteObject(siteId)));
        given(objectRepository.existsById(parentId)).willReturn(true);
        // resolveSpaceSiteId for parentId returns otherSiteId
        given(ontologyService.resolveSourceId(parentId, OntologyService.CONTAINS)).willReturn(otherSiteId);
        given(ontologyService.getObject(otherSiteId)).willReturn(makeSiteObject(otherSiteId));

        assertThatThrownBy(() -> spaceService.createSpace(siteId,
            new SpaceService.CreateSpaceRequest("APARTMENT", "Apt 1A", parentId, null)))
            .isInstanceOf(ValidationException.class)
            .hasMessageContaining("same site");

        verify(ontologyService, never()).registerObject(any(), any(), any(), any(), any());
    }

    // --- updateSpace ---

    @Test
    void updateSpace_Success_Rename() {
        UUID spaceId = UUID.randomUUID();
        UUID siteId = UUID.randomUUID();
        ObjectEntity space = makeObjectEntity(spaceId, "APARTMENT", "Apt 1A");

        given(objectRepository.findById(spaceId)).willReturn(Optional.of(space));
        given(ontologyService.resolveSourceId(spaceId, OntologyService.CONTAINS)).willReturn(siteId);
        given(ontologyService.getObject(siteId)).willReturn(makeSiteObject(siteId));
        given(objectRepository.save(any(ObjectEntity.class))).willAnswer(inv -> inv.getArgument(0));

        SpaceDTO result = spaceService.updateSpace(spaceId,
            new SpaceService.UpdateSpaceRequest(null, "Apt 1B", null, null));

        assertThat(result.name()).isEqualTo("Apt 1B");
    }

    @Test
    void updateSpace_Success_ChangeType() {
        UUID spaceId = UUID.randomUUID();
        UUID siteId = UUID.randomUUID();
        ObjectEntity space = makeObjectEntity(spaceId, "ROOM", "Storage");

        given(objectRepository.findById(spaceId)).willReturn(Optional.of(space));
        given(ontologyService.resolveSourceId(spaceId, OntologyService.CONTAINS)).willReturn(siteId);
        given(ontologyService.getObject(siteId)).willReturn(makeSiteObject(siteId));
        given(objectRepository.save(any(ObjectEntity.class))).willAnswer(inv -> inv.getArgument(0));

        // UpdateSpaceRequest with type — service ignores type field on update but still saves
        spaceService.updateSpace(spaceId,
            new SpaceService.UpdateSpaceRequest("COMMON_AREA", null, null, null));

        verify(objectRepository).save(any(ObjectEntity.class));
    }

    @Test
    void updateSpace_NotFound_ThrowsNotFound() {
        UUID spaceId = UUID.randomUUID();
        given(objectRepository.findById(spaceId)).willReturn(Optional.empty());

        assertThatThrownBy(() -> spaceService.updateSpace(spaceId,
            new SpaceService.UpdateSpaceRequest(null, "New Name", null, null)))
            .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void updateSpace_SelfParent_ThrowsValidation() {
        UUID spaceId = UUID.randomUUID();
        UUID siteId = UUID.randomUUID();
        ObjectEntity space = makeObjectEntity(spaceId, "APARTMENT", "Apt 1A");

        given(objectRepository.findById(spaceId)).willReturn(Optional.of(space));
        given(ontologyService.resolveSourceId(spaceId, OntologyService.CONTAINS)).willReturn(siteId);
        given(ontologyService.getObject(siteId)).willReturn(makeSiteObject(siteId));

        assertThatThrownBy(() -> spaceService.updateSpace(spaceId,
            new SpaceService.UpdateSpaceRequest(null, null, spaceId.toString(), null)))
            .isInstanceOf(ValidationException.class)
            .hasMessageContaining("cannot be its own parent");
    }

    @Test
    void updateSpace_MoveToRoot() {
        UUID spaceId = UUID.randomUUID();
        UUID siteId = UUID.randomUUID();
        ObjectEntity space = makeObjectEntity(spaceId, "APARTMENT", "Apt 1A");

        given(objectRepository.findById(spaceId)).willReturn(Optional.of(space));
        // resolveSpaceSiteId returns siteId
        given(ontologyService.resolveSourceId(spaceId, OntologyService.CONTAINS)).willReturn(siteId);
        given(ontologyService.getObject(siteId)).willReturn(makeSiteObject(siteId));
        given(objectRepository.save(any(ObjectEntity.class))).willAnswer(inv -> inv.getArgument(0));

        spaceService.updateSpace(spaceId,
            new SpaceService.UpdateSpaceRequest(null, null, "", null));

        verify(ontologyService).replaceContainsParent(spaceId, siteId);
    }

    // --- deleteSpace ---

    @Test
    void deleteSpace_Success_ReparentsChildren() {
        UUID spaceId = UUID.randomUUID();
        UUID parentId = UUID.randomUUID();
        UUID childId = UUID.randomUUID();

        ObjectEntity childObj = makeObjectEntity(childId, "FLOOR", "Child Floor");

        given(objectRepository.existsById(spaceId)).willReturn(true);
        given(ontologyService.resolveSourceId(spaceId, OntologyService.CONTAINS)).willReturn(parentId);
        given(ontologyService.getOutboundNeighbors(spaceId, OntologyService.CONTAINS)).willReturn(List.of(childObj));

        spaceService.deleteSpace(spaceId);

        // Child should be re-parented to the deleted space's parent via links
        verify(ontologyService).replaceContainsParent(childId, parentId);
        verify(ontologyService).deleteObject(spaceId);
    }

    @Test
    void deleteSpace_Success_NoChildren() {
        UUID spaceId = UUID.randomUUID();

        given(objectRepository.existsById(spaceId)).willReturn(true);
        given(ontologyService.getOutboundNeighbors(spaceId, OntologyService.CONTAINS)).willReturn(List.of());

        spaceService.deleteSpace(spaceId);

        verify(ontologyService).deleteObject(spaceId);
    }

    @Test
    void deleteSpace_NotFound_ThrowsNotFound() {
        UUID spaceId = UUID.randomUUID();
        given(objectRepository.existsById(spaceId)).willReturn(false);

        assertThatThrownBy(() -> spaceService.deleteSpace(spaceId))
            .isInstanceOf(ResourceNotFoundException.class);
    }

    // --- Validation edge cases ---

    @Test
    void createSpace_NullType_ThrowsValidation() {
        UUID siteId = UUID.randomUUID();

        assertThatThrownBy(() -> spaceService.createSpace(siteId,
            new SpaceService.CreateSpaceRequest(null, "Test", null, null)))
            .isInstanceOf(ValidationException.class)
            .hasMessageContaining("Space type must not be empty");
    }

    @Test
    void createSpace_NullName_ThrowsValidation() {
        UUID siteId = UUID.randomUUID();

        assertThatThrownBy(() -> spaceService.createSpace(siteId,
            new SpaceService.CreateSpaceRequest("FLOOR", null, null, null)))
            .isInstanceOf(ValidationException.class)
            .hasMessageContaining("Space name must not be empty");
    }

    @Test
    void createSpace_AllValidTypes_Accepted() {
        UUID siteId = UUID.randomUUID();
        ObjectEntity site = makeSiteObject(siteId);
        given(objectRepository.findById(siteId)).willReturn(Optional.of(site));
        given(ontologyService.registerObject(any(UUID.class), any(String.class), any(), any(String.class), any(String.class)))
            .willAnswer(inv -> {
                String typeName = inv.getArgument(1);
                String name = inv.getArgument(3);
                UUID id = UUID.randomUUID();
                return makeObjectEntity(id, typeName, name);
            });
        given(ontologyService.resolveSourceId(any(UUID.class), eq(OntologyService.CONTAINS))).willReturn(siteId);
        given(ontologyService.getObject(siteId)).willReturn(site);

        List<String> validTypes = List.of("FLOOR", "APARTMENT", "ROOM", "BASEMENT", "COMMON_AREA", "TECHNICAL_ROOM");
        for (String type : validTypes) {
            SpaceDTO result = spaceService.createSpace(siteId,
                new SpaceService.CreateSpaceRequest(type, "Space " + type, null, null));
            assertThat(result.type()).isEqualTo(type);
        }
    }
}
