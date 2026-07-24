"""Commission the mock fleet in the platform database.

Stands in for the commissioning UI, on two layers:

1. Data path: physical_devices + metric_points (+ threshold_rules), which
   device-management's projection sweep turns into `device.configured` so
   ingestion accepts the fleet's telemetry.
2. Ontology/UI path: a project, one BUILDING per site, one asset object per
   device (BOILER / GENERIC_SENSOR), INSTALLED_AT links (asset → building)
   and HAS_METRIC links (asset → metric point). This is what makes the fleet
   visible in the frontend's project Monitor (health, synoptic view, latest
   values) and analysis pages.

Idempotent: all ids are deterministic (uuid5), every statement upserts.
`--remove` deletes the fleet again (objects cascade to devices, metric points,
links and rules), which also exercises the projection's tombstone path.
"""

from __future__ import annotations

import json
import logging
import uuid

import psycopg

from .fleet import (
    KIND_BOILER,
    UUID_NAMESPACE,
    DeviceSpec,
    build_fleet,
    building_name,
    building_object_id,
    floor_object_id,
    project_id,
    room_object_id,
    technical_room_object_id,
    tenant_id,
)
from .scenario import Scenario

log = logging.getLogger("mock.seed")

TENANT_NAME = "Mock Fleet"
PROJECT_NAME = "Mock Fleet"

REQUIRED_OBJECT_TYPES = (
    "PHYSICAL_DEVICE",
    "METRIC_POINT",
    "BUILDING",
    "FLOOR",
    "ROOM",
    "TECHNICAL_ROOM",
    "BOILER",
    "GENERIC_SENSOR",
)
# INSTALLED_AT (asset → site root) puts assets in project scope and feeds the
# health view, which also requires REALIZED_BY (asset → physical device).
# CONTAINS builds the spatial hierarchy, INSTALLED_IN places assets in rooms
# (display only), HAS_METRIC attaches metric points to assets.
REQUIRED_LINK_TYPES = ("CONTAINS", "INSTALLED_AT", "INSTALLED_IN", "REALIZED_BY", "HAS_METRIC")


def _resolve_object_types(cur: psycopg.Cursor) -> dict[str, str]:
    cur.execute(
        "SELECT name, id FROM object_types WHERE name = ANY(%s)", (list(REQUIRED_OBJECT_TYPES),)
    )
    types = {name: str(oid) for name, oid in cur.fetchall()}
    missing = set(REQUIRED_OBJECT_TYPES) - set(types)
    if missing:
        raise RuntimeError(
            f"object_types missing {missing}; run core-platform once so Flyway seeds the ontology"
        )
    return types


def _resolve_link_types(cur: psycopg.Cursor) -> dict[str, str]:
    cur.execute("SELECT name, id FROM link_types WHERE name = ANY(%s)", (list(REQUIRED_LINK_TYPES),))
    types = {name: str(lid) for name, lid in cur.fetchall()}
    missing = set(REQUIRED_LINK_TYPES) - set(types)
    if missing:
        raise RuntimeError(
            f"link_types missing {missing}; run core-platform once so Flyway seeds the ontology"
        )
    return types


def _resolve_quantities(cur: psycopg.Cursor) -> dict[str, str]:
    """PHYSICAL_QUANTITY objects by display name (optional linkage, may be empty)."""
    cur.execute(
        """
        SELECT o.display_name, o.id
        FROM objects o
        JOIN object_types ot ON ot.id = o.object_type_id
        WHERE ot.name = 'PHYSICAL_QUANTITY'
        """
    )
    return {name: str(oid) for name, oid in cur.fetchall() if name}


def seed_fleet(scenario: Scenario, with_rules: bool = True) -> dict[str, int]:
    fleet = [d for d in build_fleet(scenario) if d.seeded]
    prefix = scenario.prefix
    tid = str(tenant_id(prefix))
    counts = {"devices": 0, "metric_points": 0, "rules": 0, "buildings": 0, "links": 0}

    with psycopg.connect(scenario.dsn) as conn:
        with conn.cursor() as cur:
            types = _resolve_object_types(cur)
            link_types = _resolve_link_types(cur)
            quantities = _resolve_quantities(cur)

            cur.execute(
                """
                INSERT INTO tenants (id, name, type, status)
                VALUES (%s, %s, 'standard', 'active')
                ON CONFLICT (id) DO NOTHING
                """,
                (tid, TENANT_NAME),
            )

            site_indices = sorted({d.site_index for d in fleet})
            _seed_project_and_buildings(cur, scenario, tid, types, link_types, site_indices, counts)

            for spec in fleet:
                _seed_device(cur, spec, prefix, tid, types, quantities, with_rules, counts)
                _seed_asset_ontology(cur, spec, prefix, tid, types, link_types, counts)
        conn.commit()

    log.info(
        "seeded %d devices, %d metric points, %d rules, %d buildings, %d links (project '%s', tenant %s)",
        counts["devices"],
        counts["metric_points"],
        counts["rules"],
        counts["buildings"],
        counts["links"],
        PROJECT_NAME,
        tid,
    )
    return counts


def _upsert_object(cur: psycopg.Cursor, oid: str, type_id: str, tid: str, name: str) -> None:
    cur.execute(
        """
        INSERT INTO objects (id, object_type_id, tenant_id, display_name)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = now()
        """,
        (oid, type_id, tid, name),
    )


def _upsert_link(cur: psycopg.Cursor, link_type_id: str, source: str, target: str, counts: dict[str, int]) -> None:
    cur.execute(
        """
        INSERT INTO links (link_type_id, source_object_id, target_object_id)
        VALUES (%s, %s, %s)
        ON CONFLICT (source_object_id, target_object_id, link_type_id) DO NOTHING
        """,
        (link_type_id, source, target),
    )
    counts["links"] += 1


def _seed_project_and_buildings(
    cur: psycopg.Cursor,
    scenario: Scenario,
    tid: str,
    types: dict[str, str],
    link_types: dict[str, str],
    site_indices: list[int],
    counts: dict[str, int],
) -> None:
    """Project + per site: BUILDING (project root) → FLOOR → TECHNICAL_ROOM + ROOMs."""
    prefix = scenario.prefix
    pid = str(project_id(prefix))
    cur.execute(
        """
        INSERT INTO projects (id, tenant_id, name, description, status)
        VALUES (%s, %s, %s, 'Simulated heating fleet (mock-service)', 'active')
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
        """,
        (pid, tid, PROJECT_NAME),
    )
    for site in site_indices:
        building = str(building_object_id(prefix, site))
        floor = str(floor_object_id(prefix, site))
        techroom = str(technical_room_object_id(prefix, site))

        _upsert_object(cur, building, types["BUILDING"], tid, building_name(prefix, site))
        cur.execute(
            """
            INSERT INTO project_objects (project_id, object_id)
            VALUES (%s, %s)
            ON CONFLICT (project_id, object_id) DO NOTHING
            """,
            (pid, building),
        )
        _upsert_object(cur, floor, types["FLOOR"], tid, "EG")
        _upsert_object(cur, techroom, types["TECHNICAL_ROOM"], tid, f"Heizraum {site:03d}")
        _upsert_link(cur, link_types["CONTAINS"], building, floor, counts)
        _upsert_link(cur, link_types["CONTAINS"], floor, techroom, counts)
        for room in range(1, scenario.rooms_per_site + 1):
            room_obj = str(room_object_id(prefix, site, room))
            _upsert_object(cur, room_obj, types["ROOM"], tid, f"Raum {site:03d}-{room:02d}")
            _upsert_link(cur, link_types["CONTAINS"], floor, room_obj, counts)
        counts["buildings"] += 1


def _seed_asset_ontology(
    cur: psycopg.Cursor,
    spec: DeviceSpec,
    prefix: str,
    tid: str,
    types: dict[str, str],
    link_types: dict[str, str],
    counts: dict[str, int],
) -> None:
    """Asset object + its links: INSTALLED_AT site root (scope + health),
    INSTALLED_IN its room (display), REALIZED_BY the physical device (health),
    HAS_METRIC its metric points (values)."""
    asset = str(spec.asset_object_id(prefix))
    building = str(building_object_id(prefix, spec.site_index))
    location = (
        str(room_object_id(prefix, spec.site_index, spec.room_index))
        if spec.room_index is not None
        else str(technical_room_object_id(prefix, spec.site_index))
    )

    _upsert_object(cur, asset, types[spec.asset_type], tid, spec.asset_name or spec.device_id)
    _upsert_link(cur, link_types["INSTALLED_AT"], asset, building, counts)
    _upsert_link(cur, link_types["INSTALLED_IN"], asset, location, counts)
    _upsert_link(cur, link_types["REALIZED_BY"], asset, str(spec.object_id(prefix)), counts)

    for metric in spec.metrics:
        cur.execute(
            "SELECT id FROM metric_points WHERE device_id = %s AND metric_id = %s",
            (spec.device_id, metric.metric_id),
        )
        row = cur.fetchone()
        if row is None:
            continue
        _upsert_link(cur, link_types["HAS_METRIC"], asset, str(row[0]), counts)


def _seed_device(
    cur: psycopg.Cursor,
    spec: DeviceSpec,
    prefix: str,
    tid: str,
    types: dict[str, str],
    quantities: dict[str, str],
    with_rules: bool,
    counts: dict[str, int],
) -> None:
    device_object = str(spec.object_id(prefix))
    cur.execute(
        """
        INSERT INTO objects (id, object_type_id, tenant_id, display_name)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = now()
        """,
        (device_object, types["PHYSICAL_DEVICE"], tid, spec.device_id),
    )
    manufacturer, model = (
        ("Shelly", "Plus H&T") if spec.kind == "shelly-ht" else ("Generic", "Boiler Controller")
    )
    cur.execute(
        """
        INSERT INTO physical_devices (id, device_id, manufacturer, model, protocol, commissioned_at)
        VALUES (%s, %s, %s, %s, 'MQTT', now())
        ON CONFLICT (device_id) DO UPDATE
            SET protocol = 'MQTT', decommissioned_at = NULL, updated_at = now()
        """,
        (device_object, spec.device_id, manufacturer, model),
    )
    counts["devices"] += 1

    for metric in spec.metrics:
        metric_object = str(spec.metric_object_id(prefix, metric.metric_id))
        cur.execute(
            """
            INSERT INTO objects (id, object_type_id, tenant_id, display_name)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = now()
            """,
            (metric_object, types["METRIC_POINT"], tid, metric.name),
        )
        cur.execute(
            """
            INSERT INTO metric_points (id, device_id, metric_id, source, field, unit, quantity_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (device_id, metric_id) DO UPDATE
                SET source = EXCLUDED.source, field = EXCLUDED.field,
                    unit = EXCLUDED.unit, quantity_id = EXCLUDED.quantity_id,
                    updated_at = now()
            """,
            (
                metric_object,
                spec.device_id,
                metric.metric_id,
                metric.source,
                metric.field,
                metric.unit,
                quantities.get(metric.quantity) if metric.quantity else None,
            ),
        )
        counts["metric_points"] += 1

    if not with_rules:
        return
    for rule in spec.rules:
        # The rule must reference the metric point's actual object id (an
        # earlier seed with another prefix may own this device_id/metric_id).
        cur.execute(
            "SELECT id FROM metric_points WHERE device_id = %s AND metric_id = %s",
            (spec.device_id, rule.metric_id),
        )
        row = cur.fetchone()
        if row is None:
            continue
        cur.execute(
            """
            INSERT INTO threshold_rules
                (id, metric_point_id, operator, threshold, severity, cooldown_seconds, enabled, tenant_id)
            VALUES (%s, %s, %s, %s, %s, %s, true, %s)
            ON CONFLICT (id) DO UPDATE
                SET threshold = EXCLUDED.threshold, severity = EXCLUDED.severity,
                    cooldown_seconds = EXCLUDED.cooldown_seconds, enabled = true,
                    updated_at = now()
            """,
            (
                str(spec.rule_id(prefix, rule)),
                str(row[0]),
                rule.operator,
                rule.threshold,
                rule.severity,
                rule.cooldown_seconds,
                tid,
            ),
        )
        counts["rules"] += 1

    _seed_anomaly_rules(cur, spec, prefix, tid, counts)


# Default anomaly rules per boiler: the former hardcoded weather-context
# detector as data — template instances bound to the pump switch channel.
_BOILER_ANOMALY_RULES = (
    ("short_cycle", "Short cycling", {}),
    ("weather_heating", "Heating despite warm weather", {}),
)
_ANOMALY_SWITCH_METRIC_ID = 4  # Pump Running


def _seed_anomaly_rules(
    cur: psycopg.Cursor,
    spec: DeviceSpec,
    prefix: str,
    tid: str,
    counts: dict[str, int],
) -> None:
    if spec.kind != KIND_BOILER:
        return
    cur.execute(
        "SELECT id FROM metric_points WHERE device_id = %s AND metric_id = %s",
        (spec.device_id, _ANOMALY_SWITCH_METRIC_ID),
    )
    row = cur.fetchone()
    if row is None:
        return
    bindings = json.dumps([{"role": "switch", "metricPointId": str(row[0])}])
    for detector, label, params in _BOILER_ANOMALY_RULES:
        rule_id = str(
            uuid.uuid5(UUID_NAMESPACE, f"{prefix}:anomaly:{spec.device_id}:{detector}")
        )
        cur.execute(
            """
            INSERT INTO anomaly_rules
                (id, tenant_id, name, detector, params, bindings,
                 severity, cooldown_seconds, enabled)
            VALUES (%s, %s, %s, %s, %s::jsonb, %s::jsonb, 'WARNING', 1800, true)
            ON CONFLICT (id) DO UPDATE
                SET bindings = EXCLUDED.bindings, params = EXCLUDED.params,
                    enabled = true, updated_at = now()
            """,
            (
                rule_id,
                tid,
                f"{label} ({spec.asset_name or spec.device_id})",
                detector,
                json.dumps(params),
                bindings,
            ),
        )
        counts["rules"] += 1


def remove_fleet(scenario: Scenario) -> int:
    """Delete the fleet's ontology objects and project; everything else cascades."""
    fleet = [d for d in build_fleet(scenario) if d.seeded]
    prefix = scenario.prefix
    object_ids = [str(d.object_id(prefix)) for d in fleet]
    object_ids += [str(d.asset_object_id(prefix)) for d in fleet]
    object_ids += [
        str(d.metric_object_id(prefix, m.metric_id)) for d in fleet for m in d.metrics
    ]
    for site in sorted({d.site_index for d in fleet}):
        object_ids += [
            str(building_object_id(prefix, site)),
            str(floor_object_id(prefix, site)),
            str(technical_room_object_id(prefix, site)),
        ]
    object_ids += [
        str(room_object_id(prefix, d.site_index, d.room_index))
        for d in fleet
        if d.room_index is not None
    ]
    with psycopg.connect(scenario.dsn) as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM projects WHERE id = %s", (str(project_id(prefix)),))
            cur.execute("DELETE FROM objects WHERE id = ANY(%s::uuid[])", (object_ids,))
            deleted = cur.rowcount
        conn.commit()
    log.info("removed %d fleet objects (devices/metric points/links cascade) and the project", deleted)
    return deleted
