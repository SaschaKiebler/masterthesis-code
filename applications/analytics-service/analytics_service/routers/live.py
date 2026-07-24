"""Live-operations endpoints: latest value per channel and ingest rate.

These serve the frontend's Monitor view. Architecturally they complete the
"analytics is the only measurement reader" rule for the live path: the
frontend resolves structure (metric-point ids) from core and reads values
here. Responses use camelCase keys to match the shape the Monitor previously
received from core's /projects/{id}/latest-values.

Since the store split the former single-statement joins are resolved in two
steps: registry query (channel identity + display context from the
master-data store) → measurement query (latest values / rates from the
measurement store) → composition in Python.
"""

import time

from fastapi import APIRouter, Depends
import asyncpg
from pydantic import BaseModel, Field

from ..db.pool import get_pool, get_registry_pool

router = APIRouter(prefix="/stats", tags=["live"])


class LatestRequest(BaseModel):
    metric_point_ids: list[str] = Field(min_length=1, max_length=2000)


async def _resolve_channels(registry: asyncpg.Pool, metric_point_ids: list[str]) -> list[dict]:
    rows = await registry.fetch(
        """
        SELECT mp.id                 AS metric_point_id,
               mp.device_id,
               mp.metric_id,
               o.display_name,
               mp.unit,
               pq.name               AS quantity_name,
               hm.source_object_id   AS asset_object_id
        FROM metric_points mp
        JOIN objects o ON o.id = mp.id
        LEFT JOIN links hm
            ON hm.target_object_id = mp.id
            AND hm.link_type_id = (SELECT id FROM link_types WHERE name = 'HAS_METRIC')
        LEFT JOIN physical_quantities pq ON pq.id = mp.quantity_id
        WHERE mp.id = ANY($1::uuid[])
        ORDER BY mp.id
        """,
        metric_point_ids,
    )
    return [dict(r) for r in rows]


@router.post("/latest")
async def latest_values(
    req: LatestRequest,
    pool: asyncpg.Pool = Depends(get_pool),
    registry: asyncpg.Pool = Depends(get_registry_pool),
) -> dict:
    """Latest measurement per metric point, enriched like core's latest-values."""
    t0 = time.monotonic()
    channels = await _resolve_channels(registry, req.metric_point_ids)

    latest: dict[tuple[str, int], tuple[float | None, int | None]] = {}
    if channels:
        rows = await pool.fetch(
            """
            WITH pairs AS (
                SELECT unnest($1::text[]) AS device_id, unnest($2::int[]) AS metric_id
            )
            SELECT p.device_id, p.metric_id, m.value,
                   EXTRACT(EPOCH FROM m.time)::bigint AS ts
            FROM pairs p
            LEFT JOIN LATERAL (
                SELECT value, time
                FROM measurements m
                WHERE m.device_id = p.device_id AND m.metric_id = p.metric_id
                ORDER BY m.time DESC
                LIMIT 1
            ) m ON true
            """,
            [c["device_id"] for c in channels],
            [c["metric_id"] for c in channels],
        )
        latest = {
            (r["device_id"], r["metric_id"]): (r["value"], r["ts"])
            for r in rows
        }

    values = []
    for c in channels:
        value, ts = latest.get((c["device_id"], c["metric_id"]), (None, None))
        values.append(
            {
                "metricPointId": str(c["metric_point_id"]),
                "deviceId": c["device_id"],
                "metricId": c["metric_id"],
                "displayName": c["display_name"],
                "unit": c["unit"],
                "quantityName": c["quantity_name"],
                "assetObjectId": str(c["asset_object_id"]) if c["asset_object_id"] else None,
                "value": float(value) if value is not None else None,
                "time": int(ts) if ts is not None else None,
            }
        )
    return {
        "values": values,
        "computationTimeMs": int((time.monotonic() - t0) * 1000),
    }


class IngestRateRequest(BaseModel):
    metric_point_ids: list[str] | None = None  # None = whole measurement store
    window_minutes: int = Field(default=15, ge=1, le=1440)


@router.post("/ingest-rate")
async def ingest_rate(
    req: IngestRateRequest,
    pool: asyncpg.Pool = Depends(get_pool),
    registry: asyncpg.Pool = Depends(get_registry_pool),
) -> dict:
    """Measurements per minute over a sliding window (live load indicator)."""
    t0 = time.monotonic()
    if req.metric_point_ids:
        pairs = await registry.fetch(
            """
            SELECT mp.device_id, mp.metric_id
            FROM metric_points mp
            WHERE mp.id = ANY($1::uuid[])
            """,
            req.metric_point_ids,
        )
        rows = await pool.fetch(
            """
            WITH pairs AS (
                SELECT unnest($2::text[]) AS device_id, unnest($3::int[]) AS metric_id
            )
            SELECT date_trunc('minute', m.time) AS minute,
                   count(*)                     AS cnt,
                   count(DISTINCT m.device_id)  AS devices
            FROM measurements m
            JOIN pairs p ON m.device_id = p.device_id AND m.metric_id = p.metric_id
            WHERE m.time >= now() - make_interval(mins => $1)
            GROUP BY 1
            ORDER BY 1
            """,
            req.window_minutes,
            [r["device_id"] for r in pairs],
            [r["metric_id"] for r in pairs],
        )
    else:
        rows = await pool.fetch(
            """
            SELECT date_trunc('minute', m.time) AS minute,
                   count(*)                     AS cnt,
                   count(DISTINCT m.device_id)  AS devices
            FROM measurements m
            WHERE m.time >= now() - make_interval(mins => $1)
            GROUP BY 1
            ORDER BY 1
            """,
            req.window_minutes,
        )
    per_minute = [
        {
            "minute": int(r["minute"].timestamp()),
            "count": int(r["cnt"]),
            "devices": int(r["devices"]),
        }
        for r in rows
    ]
    total = sum(p["count"] for p in per_minute)
    # Peak concurrent devices in any single minute of the window
    active_devices = max((p["devices"] for p in per_minute), default=0)
    return {
        "windowMinutes": req.window_minutes,
        "perMinute": per_minute,
        "total": total,
        "ratePerMinute": round(total / req.window_minutes, 1),
        "activeDevices": active_devices,
        "computationTimeMs": int((time.monotonic() - t0) * 1000),
    }
