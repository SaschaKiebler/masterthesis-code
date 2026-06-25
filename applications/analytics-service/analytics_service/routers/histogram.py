import time

from fastapi import APIRouter, Depends
import asyncpg
import numpy as np

from ..db.pool import get_pool
from ..db.queries import fetch_metric_point_context, fetch_timeseries, resolve_bucket
from ..models.requests import TimeRange
from ..models.responses import ResponseMeta
from pydantic import BaseModel

router = APIRouter(prefix="/stats", tags=["histogram"])


class HistogramRequest(BaseModel):
    metric_point_ids: list[str]
    time_range: TimeRange
    bins: int = 30


class HistogramSeriesData(BaseModel):
    metric_point_id: str
    display_name: str | None
    unit: str | None
    bin_edges: list[float]
    counts: list[int]


class HistogramResponse(BaseModel):
    series: list[HistogramSeriesData]
    meta: ResponseMeta


@router.post("/histogram", response_model=HistogramResponse)
async def histogram(
    req: HistogramRequest,
    pool: asyncpg.Pool = Depends(get_pool),
) -> HistogramResponse:
    t0 = time.monotonic()

    mp_ctx = await fetch_metric_point_context(pool, req.metric_point_ids)
    if not mp_ctx:
        elapsed = int((time.monotonic() - t0) * 1000)
        return HistogramResponse(series=[], meta=ResponseMeta(computation_time_ms=elapsed, data_points_processed=0))

    mp_map = {(str(r["device_id"]), r["metric_id"]): r for r in mp_ctx}
    pairs = [(str(r["device_id"]), r["metric_id"]) for r in mp_ctx]

    rows = await pool.fetch(
        """
        WITH pairs AS (
            SELECT unnest($1::text[]) AS device_id, unnest($2::int[]) AS metric_id
        )
        SELECT m.device_id, m.metric_id, m.value
        FROM measurements m
        JOIN pairs p ON m.device_id = p.device_id AND m.metric_id = p.metric_id
        WHERE m.time >= to_timestamp($3) AND m.time < to_timestamp($4)
          AND m.value IS NOT NULL
        """,
        [d for d, _ in pairs], [m for _, m in pairs],
        req.time_range.start, req.time_range.end,
    )

    # Group by device/metric
    from collections import defaultdict
    grouped: dict[tuple, list[float]] = defaultdict(list)
    for row in rows:
        grouped[(row["device_id"], row["metric_id"])].append(float(row["value"]))

    series = []
    for (device_id, metric_id), values in grouped.items():
        ctx = mp_map.get((device_id, metric_id), {})
        arr = np.array(values)
        counts_arr, edges_arr = np.histogram(arr, bins=req.bins)
        series.append(HistogramSeriesData(
            metric_point_id=str(ctx.get("id", "")),
            display_name=ctx.get("display_name"),
            unit=ctx.get("unit"),
            bin_edges=[round(float(e), 4) for e in edges_arr],
            counts=[int(c) for c in counts_arr],
        ))

    elapsed = int((time.monotonic() - t0) * 1000)
    return HistogramResponse(
        series=series,
        meta=ResponseMeta(computation_time_ms=elapsed, data_points_processed=len(rows)),
    )
