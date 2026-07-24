"""Channel-keyed series and latest-value endpoints (resolve-then-fetch,
measurement-read-decoupling design §5).

Callers (core / the BFF) resolve their ontology graph down to channels
(device_id, metric_id) and pass them here together with an opaque ref (the
metric_point id) that is echoed back for correlation. These endpoints never
read the registry — analytics stays out of core's tables on this path.
"""

import time
from collections import defaultdict

from fastapi import APIRouter, Depends
import asyncpg
from pydantic import BaseModel, Field

from ..db.pool import get_pool
from ..db.queries import (
    fetch_descriptive_stats,
    fetch_raw_timeseries,
    fetch_timeseries,
    resolve_bucket,
)

router = APIRouter(prefix="/stats", tags=["series"])


class Channel(BaseModel):
    device_id: str
    metric_id: int
    ref: str | None = None  # opaque tag (the metric_point id); echoed, never interpreted


class SeriesRequest(BaseModel):
    channels: list[Channel] = Field(min_length=1, max_length=2000)
    start: int  # epoch seconds
    end: int
    resample: str = "auto"  # named bucket, "auto", or "raw" (no bucketing)
    aggregation: str = "mean"
    bucket_seconds: int | None = Field(default=None, ge=1)  # explicit override


@router.post("/series")
async def series(req: SeriesRequest, pool: asyncpg.Pool = Depends(get_pool)) -> dict:
    t0 = time.monotonic()
    pairs = [(c.device_id, c.metric_id) for c in req.channels]
    if req.resample == "raw":
        bucket = 0
        rows = await fetch_raw_timeseries(pool, pairs, req.start, req.end)
    else:
        bucket = req.bucket_seconds or resolve_bucket(req.resample, req.start, req.end)
        rows = await fetch_timeseries(pool, pairs, req.start, req.end, bucket, req.aggregation)

    ref = {(c.device_id, c.metric_id): c.ref for c in req.channels}
    grouped: dict[tuple[str, int], list] = defaultdict(list)
    for r in rows:
        grouped[(r["device_id"], r["metric_id"])].append(
            {"bucket": int(r["bucket"]), "value": float(r["value"]) if r["value"] is not None else None}
        )

    return {
        "bucketSeconds": bucket,
        "series": [
            {
                "deviceId": d,
                "metricId": m,
                "ref": ref.get((d, m)),
                "points": points,
            }
            for (d, m), points in grouped.items()
        ],
        "computationTimeMs": int((time.monotonic() - t0) * 1000),
    }


class StatsByChannelRequest(BaseModel):
    channels: list[Channel] = Field(min_length=1, max_length=2000)
    start: int
    end: int


@router.post("/descriptive-by-channel")
async def descriptive_by_channel(
    req: StatsByChannelRequest, pool: asyncpg.Pool = Depends(get_pool)
) -> dict:
    """Per-channel descriptive statistics (the former core site statistics)."""
    t0 = time.monotonic()
    pairs = [(c.device_id, c.metric_id) for c in req.channels]
    rows = await fetch_descriptive_stats(pool, pairs, req.start, req.end)
    ref = {(c.device_id, c.metric_id): c.ref for c in req.channels}
    return {
        "statistics": [
            {
                "deviceId": r["device_id"],
                "metricId": r["metric_id"],
                "ref": ref.get((r["device_id"], r["metric_id"])),
                "count": int(r["count"]),
                "mean": float(r["mean"]) if r["mean"] is not None else None,
                "median": float(r["median"]) if r["median"] is not None else None,
                "std": float(r["std"]) if r["std"] is not None else None,
                "min": float(r["min"]) if r["min"] is not None else None,
                "max": float(r["max"]) if r["max"] is not None else None,
            }
            for r in rows
        ],
        "computationTimeMs": int((time.monotonic() - t0) * 1000),
    }


class LatestByChannelRequest(BaseModel):
    channels: list[Channel] = Field(min_length=1, max_length=5000)


@router.post("/latest-by-channel")
async def latest_by_channel(
    req: LatestByChannelRequest, pool: asyncpg.Pool = Depends(get_pool)
) -> dict:
    """Latest value and time per channel (fleet health / synoptic overlays)."""
    t0 = time.monotonic()
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
        [c.device_id for c in req.channels],
        [c.metric_id for c in req.channels],
    )
    latest = {(r["device_id"], r["metric_id"]): r for r in rows}
    return {
        "values": [
            {
                "deviceId": c.device_id,
                "metricId": c.metric_id,
                "ref": c.ref,
                "value": (
                    float(latest[(c.device_id, c.metric_id)]["value"])
                    if latest.get((c.device_id, c.metric_id))
                    and latest[(c.device_id, c.metric_id)]["value"] is not None
                    else None
                ),
                "time": (
                    int(latest[(c.device_id, c.metric_id)]["ts"])
                    if latest.get((c.device_id, c.metric_id))
                    and latest[(c.device_id, c.metric_id)]["ts"] is not None
                    else None
                ),
            }
            for c in req.channels
        ],
        "computationTimeMs": int((time.monotonic() - t0) * 1000),
    }
