package com.digitaldemon.core.privacy;

import com.digitaldemon.core.common.exception.ResourceNotFoundException;
import com.digitaldemon.core.device.PhysicalDevice;
import com.digitaldemon.core.device.PhysicalDeviceRepository;
import com.digitaldemon.core.metricpoint.MetricPoint;
import com.digitaldemon.core.metricpoint.MetricPointRepository;
import com.digitaldemon.core.ontology.Link;
import com.digitaldemon.core.ontology.LinkRepository;
import com.digitaldemon.core.ontology.LinkType;
import com.digitaldemon.core.ontology.LinkTypeRepository;
import com.digitaldemon.core.ontology.ObjectEntity;
import com.digitaldemon.core.ontology.ObjectRepository;
import com.digitaldemon.core.ontology.ObjectType;
import com.digitaldemon.core.tenant.Tenant;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.verify;

/**
 * Covers the graph walk that turns a resident into their consumption data —
 * the chain QS-SEC-02 is evaluated on — and the erasure semantics: the person
 * object goes, the measurement series stays.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class PersonPrivacyServiceTest {

    @Mock
    private ObjectRepository objectRepository;
    @Mock
    private LinkRepository linkRepository;
    @Mock
    private LinkTypeRepository linkTypeRepository;
    @Mock
    private PhysicalDeviceRepository physicalDeviceRepository;
    @Mock
    private MetricPointRepository metricPointRepository;
    @Mock
    private MeasurementReadStore measurementReadStore;

    private PersonPrivacyService service;

    private final UUID personId = UUID.randomUUID();
    private final UUID apartmentId = UUID.randomUUID();
    private final UUID roomId = UUID.randomUUID();
    private final UUID assetId = UUID.randomUUID();
    private final UUID physicalDeviceObjectId = UUID.randomUUID();
    private final UUID metricPointObjectId = UUID.randomUUID();
    private final UUID tenantId = UUID.randomUUID();

    private ObjectEntity person;
    private ObjectEntity apartment;
    private ObjectEntity room;
    private ObjectEntity asset;

    @BeforeEach
    void setUp() {
        service = new PersonPrivacyService(objectRepository, linkRepository, linkTypeRepository,
                physicalDeviceRepository, metricPointRepository, measurementReadStore);

        person = object(personId, "PERSON", "Erika Musterfrau",
                "{\"email\":\"erika@example.org\",\"phone\":\"+49 111\"}");
        apartment = object(apartmentId, "APARTMENT", "Wohnung 1A", "{}");
        room = object(roomId, "ROOM", "Wohnzimmer", "{}");
        asset = object(assetId, "GENERIC_SENSOR", "Raumsensor 1A", "{}");

        // Link types resolve by name; ids are arbitrary but stable per name.
        for (String name : List.of("RESIDES_IN", "CONTAINS", "INSTALLED_IN", "REALIZED_BY", "HAS_METRIC")) {
            LinkType type = new LinkType();
            type.setId(UUID.nameUUIDFromBytes(name.getBytes()));
            type.setName(name);
            given(linkTypeRepository.findByName(name)).willReturn(Optional.of(type));
        }

        given(objectRepository.findById(personId)).willReturn(Optional.of(person));
        given(linkRepository.findBySourceAndLinkType(any(), any())).willReturn(List.of());
        given(linkRepository.findByTargetAndLinkType(any(), any())).willReturn(List.of());
        given(linkRepository.findOutboundByObjectId(personId)).willReturn(List.of());
        given(linkRepository.findInboundByObjectId(personId)).willReturn(List.of());
    }

    private ObjectEntity object(UUID id, String typeName, String name, String properties) {
        ObjectType type = new ObjectType();
        type.setName(typeName);
        Tenant tenant = new Tenant();
        tenant.setId(tenantId);
        ObjectEntity entity = new ObjectEntity();
        entity.setId(id);
        entity.setObjectType(type);
        entity.setTenant(tenant);
        entity.setDisplayName(name);
        entity.setProperties(properties);
        return entity;
    }

    private Link link(String typeName, ObjectEntity source, ObjectEntity target) {
        Link link = new Link();
        link.setSource(source);
        link.setTarget(target);
        return link;
    }

    private UUID typeId(String name) {
        return UUID.nameUUIDFromBytes(name.getBytes());
    }

    /** Wires the full chain person → apartment → room → asset → device. */
    private void wireChain() {
        given(linkRepository.findBySourceAndLinkType(personId, typeId("RESIDES_IN")))
                .willReturn(List.of(link("RESIDES_IN", person, apartment)));
        given(linkRepository.findBySourceAndLinkType(apartmentId, typeId("CONTAINS")))
                .willReturn(List.of(link("CONTAINS", apartment, room)));
        given(linkRepository.findByTargetAndLinkType(roomId, typeId("INSTALLED_IN")))
                .willReturn(List.of(link("INSTALLED_IN", asset, room)));

        ObjectEntity deviceObject = object(physicalDeviceObjectId, "GENERIC_SENSOR", "Sensor", "{}");
        given(linkRepository.findBySourceAndLinkType(assetId, typeId("REALIZED_BY")))
                .willReturn(List.of(link("REALIZED_BY", asset, deviceObject)));
        PhysicalDevice device = new PhysicalDevice();
        device.setId(physicalDeviceObjectId);
        device.setDeviceId("mock-ht-001-01");
        given(physicalDeviceRepository.findById(physicalDeviceObjectId)).willReturn(Optional.of(device));

        // HAS_METRIC resolves to the same device id — must not duplicate.
        ObjectEntity metricObject = object(metricPointObjectId, "METRIC_POINT", "Temperatur", "{}");
        given(linkRepository.findBySourceAndLinkType(assetId, typeId("HAS_METRIC")))
                .willReturn(List.of(link("HAS_METRIC", asset, metricObject)));
        MetricPoint metricPoint = new MetricPoint();
        metricPoint.setId(metricPointObjectId);
        metricPoint.setDeviceId("mock-ht-001-01");
        metricPoint.setMetricId((short) 1);
        given(metricPointRepository.findById(metricPointObjectId)).willReturn(Optional.of(metricPoint));

        given(measurementReadStore.countForDevice("mock-ht-001-01")).willReturn(2L);
        given(measurementReadStore.seriesForDevice("mock-ht-001-01")).willReturn(List.of(
                new MeasurementReadStore.MeasurementRow(Instant.parse("2026-08-10T12:00:00Z"), (short) 1, 21.5),
                new MeasurementReadStore.MeasurementRow(Instant.parse("2026-08-10T12:00:10Z"), (short) 1, 21.6)));
    }

    @Test
    void export_walks_the_chain_to_the_measurement_series() {
        wireChain();

        PersonPrivacyService.PersonExport export = service.export(personId);

        assertThat(export.displayName()).isEqualTo("Erika Musterfrau");
        assertThat(export.tenantId()).isEqualTo(tenantId);
        assertThat(export.properties()).containsEntry("email", "erika@example.org");
        assertThat(export.residences()).singleElement()
                .satisfies(r -> assertThat(r.spaceId()).isEqualTo(apartmentId));
        // One device despite two resolution paths (REALIZED_BY and HAS_METRIC).
        assertThat(export.devices()).singleElement()
                .satisfies(d -> assertThat(d.deviceId()).isEqualTo("mock-ht-001-01"));
        assertThat(export.measurementSeries()).singleElement().satisfies(s -> {
            assertThat(s.count()).isEqualTo(2);
            assertThat(s.values()).hasSize(2);
        });
    }

    @Test
    void export_of_an_unknown_id_is_a_404() {
        given(objectRepository.findById(personId)).willReturn(Optional.empty());
        assertThatThrownBy(() -> service.export(personId))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    /** A non-PERSON object must not be exportable through the privacy endpoint. */
    @Test
    void export_of_a_non_person_object_is_a_404() {
        given(objectRepository.findById(personId))
                .willReturn(Optional.of(object(personId, "APARTMENT", "Wohnung", "{}")));
        assertThatThrownBy(() -> service.export(personId))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void erasure_deletes_the_person_and_reports_the_retained_series() {
        wireChain();
        given(linkRepository.findOutboundByObjectId(personId))
                .willReturn(List.of(link("RESIDES_IN", person, apartment)));

        PersonPrivacyService.ErasureReport report = service.erase(personId);

        // Links first, then the object. The first QS-SEC-02 run failed with a
        // TransientPropertyValueException because the object was removed while
        // its loaded links were still managed. Order is part of the contract.
        InOrder order = inOrder(linkRepository, objectRepository);
        order.verify(linkRepository).deleteAll(anyList());
        order.verify(objectRepository).delete(person);
        assertThat(report.deletedLinks()).isEqualTo(1);
        assertThat(report.retainedMeasurementsByDevice())
                .containsEntry("mock-ht-001-01", 2L);
        assertThat(report.retentionNote()).contains("Art. 17(3)(b)");
    }

    /** A malformed CONTAINS cycle must terminate, not hang the export. */
    @Test
    void a_contains_cycle_terminates() {
        given(linkRepository.findBySourceAndLinkType(personId, typeId("RESIDES_IN")))
                .willReturn(List.of(link("RESIDES_IN", person, apartment)));
        given(linkRepository.findBySourceAndLinkType(apartmentId, typeId("CONTAINS")))
                .willReturn(List.of(link("CONTAINS", apartment, room)));
        given(linkRepository.findBySourceAndLinkType(roomId, typeId("CONTAINS")))
                .willReturn(List.of(link("CONTAINS", room, apartment)));

        PersonPrivacyService.PersonExport export = service.export(personId);

        assertThat(export.devices()).isEmpty();
    }
}
