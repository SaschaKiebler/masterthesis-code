"""Commission the mock fleet in the platform database.

Stands in for the commissioning UI: writes the ontology objects,
physical_devices, metric_points and (optionally) threshold_rules that
device-management's projection sweep turns into `device.configured`, which is
what makes ingestion accept the fleet's telemetry.

Idempotent: all ids are deterministic (uuid5), every statement upserts.
`--remove` deletes the fleet again (objects cascade to devices, metric points
and rules), which also exercises the projection's tombstone path.
"""

from __future__ import annotations

import logging

import psycopg

from .fleet import DeviceSpec, build_fleet, tenant_id
from .scenario import Scenario

log = logging.getLogger("mock.seed")

TENANT_NAME = "Mock Fleet"


def _resolve_object_types(cur: psycopg.Cursor) -> dict[str, str]:
    cur.execute("SELECT name, id FROM object_types WHERE name IN ('PHYSICAL_DEVICE', 'METRIC_POINT')")
    types = {name: str(oid) for name, oid in cur.fetchall()}
    missing = {"PHYSICAL_DEVICE", "METRIC_POINT"} - set(types)
    if missing:
        raise RuntimeError(
            f"object_types missing {missing}; run core-platform once so Flyway seeds the ontology"
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
    counts = {"devices": 0, "metric_points": 0, "rules": 0}

    with psycopg.connect(scenario.dsn) as conn:
        with conn.cursor() as cur:
            types = _resolve_object_types(cur)
            quantities = _resolve_quantities(cur)

            cur.execute(
                """
                INSERT INTO tenants (id, name, type, status)
                VALUES (%s, %s, 'standard', 'active')
                ON CONFLICT (id) DO NOTHING
                """,
                (tid, TENANT_NAME),
            )

            for spec in fleet:
                _seed_device(cur, spec, prefix, tid, types, quantities, with_rules, counts)
        conn.commit()

    log.info(
        "seeded %d devices, %d metric points, %d threshold rules (tenant %s '%s')",
        counts["devices"],
        counts["metric_points"],
        counts["rules"],
        tid,
        TENANT_NAME,
    )
    return counts


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


def remove_fleet(scenario: Scenario) -> int:
    """Delete the fleet's ontology objects; devices, metric points and rules cascade."""
    fleet = [d for d in build_fleet(scenario) if d.seeded]
    prefix = scenario.prefix
    object_ids = [str(d.object_id(prefix)) for d in fleet]
    object_ids += [
        str(d.metric_object_id(prefix, m.metric_id)) for d in fleet for m in d.metrics
    ]
    with psycopg.connect(scenario.dsn) as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM objects WHERE id = ANY(%s::uuid[])", (object_ids,))
            deleted = cur.rowcount
        conn.commit()
    log.info("removed %d fleet objects (devices/metric points cascade)", deleted)
    return deleted
