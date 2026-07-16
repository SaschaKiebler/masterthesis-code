"""Live-operations endpoints: latest value per channel and ingest rate.

These serve the frontend's Monitor view. Architecturally they complete the
"analytics is the only measurement reader" rule for the live path: the
frontend resolves structure (metric-point ids) from core and reads values
here. Responses use camelCase keys to match the shape the Monitor previously
received from core's /projects/{id}/latest-values.
"""

import time

from fastapi import APIRouter, Depends
import asyncpg
from pydantic import BaseModel, Field

from ..db.pool import get_pool

router = APIRouter(prefix="/stats", tags=["live"])


class LatestRequest(BaseModel):
    metric_point_ids: list[str] = Field(min_length=1, max_length=2000)


@router.post("/latest")
async def latest_values(
    req: LatestRequest,
    pool: asyncpg.Pool = Depends(get_pool),
) -> dict:
    """Latest measurement per metric point, enriched like core's latest-values."""
    t0 = time.monotonic()
    rows = await pool.fetch(
        """
        SELECT DISTINCT ON (mp.id)
            mp.id                 AS metric_point_id,
            mp.device_id,
            mp.metric_id,
            o.display_name,
            mp.unit,
            pq.name               AS quantity_name,
            hm.source_object_id   AS asset_object_id,
            m.value,
            EXTRACT(EPOCH FROM m.time)::bigint AS ts
        FROM metric_points mp
        JOIN objects o ON o.id = mp.id
        LEFT JOIN links hm
            ON hm.target_object_id = mp.id
            AND hm.link_type_id = (SELECT id FROM link_types WHERE name = 'HAS_METRIC')
        LEFT JOIN physical_quantities pq ON pq.id = mp.quantity_id
        LEFT JOIN LATERAL (
            SELECT value, time
            FROM measurements m
            WHERE m.device_id = mp.device_id AND m.metric_id = mp.metric_id
            ORDER BY m.time DESC
            LIMIT 1
        ) m ON true
        WHERE mp.id = ANY($1::uuid[])
        ORDER BY mp.id
        """,
        req.metric_point_ids,
    )
    values = [
        {
            "metricPointId": str(r["metric_point_id"]),
            "deviceId": r["device_id"],
            "metricId": r["metric_id"],
            "displayName": r["display_name"],
            "unit": r["unit"],
            "quantityName": r["quantity_name"],
            "assetObjectId": str(r["asset_object_id"]) if r["asset_object_id"] else None,
            "value": float(r["value"]) if r["value"] is not None else None,
            "time": int(r["ts"]) if r["ts"] is not None else None,
        }
        for r in rows
    ]
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
) -> dict:
    """Measurements per minute over a sliding window (live load indicator)."""
    t0 = time.monotonic()
    if req.metric_point_ids:
        rows = await pool.fetch(
            """
            SELECT date_trunc('minute', m.time) AS minute,
                   count(*)                     AS cnt,
                   count(DISTINCT m.device_id)  AS devices
            FROM measurements m
            WHERE m.time >= now() - make_interval(mins => $1)
              AND (m.device_id, m.metric_id) IN (
                    SELECT mp.device_id, mp.metric_id
                    FROM metric_points mp
                    WHERE mp.id = ANY($2::uuid[]))
            GROUP BY 1
            ORDER BY 1
            """,
            req.window_minutes,
            req.metric_point_ids,
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
