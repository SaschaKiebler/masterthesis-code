import time
from collections import defaultdict

from fastapi import APIRouter, Depends
import asyncpg
import numpy as np

from ..db.pool import get_pool
from ..db.queries import fetch_metric_point_context
from ..models.requests import TimeRange
from ..models.responses import ResponseMeta
from pydantic import BaseModel

router = APIRouter(prefix="/stats", tags=["heatmap"])

WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


class HeatmapRequest(BaseModel):
    metric_point_id: str
    time_range: TimeRange
    aggregation: str = "mean"  # mean, min, max


class HeatmapResponse(BaseModel):
    x_labels: list[str]  # hours: "00", "01", ..., "23"
    y_labels: list[str]  # weekdays: "Mon", ..., "Sun"
    data: list[list[float | None]]  # [x_index, y_index, value]
    min_value: float | None
    max_value: float | None
    metric_point_id: str
    display_name: str | None
    unit: str | None
    meta: ResponseMeta


@router.post("/heatmap", response_model=HeatmapResponse)
async def heatmap(
    req: HeatmapRequest,
    pool: asyncpg.Pool = Depends(get_pool),
) -> HeatmapResponse:
    t0 = time.monotonic()

    mp_ctx = await fetch_metric_point_context(pool, [req.metric_point_id])
    if not mp_ctx:
        elapsed = int((time.monotonic() - t0) * 1000)
        return HeatmapResponse(
            x_labels=[], y_labels=[], data=[], min_value=None, max_value=None,
            metric_point_id=req.metric_point_id, display_name=None, unit=None,
            meta=ResponseMeta(computation_time_ms=elapsed, data_points_processed=0),
        )

    ctx = mp_ctx[0]
    agg_fn = {"mean": "AVG", "min": "MIN", "max": "MAX"}.get(req.aggregation, "AVG")

    rows = await pool.fetch(
        f"""
        SELECT
            EXTRACT(ISODOW FROM m.time)::int AS dow,
            EXTRACT(HOUR FROM m.time)::int AS hour,
            {agg_fn}(m.value) AS value
        FROM measurements m
        WHERE m.device_id = $1 AND m.metric_id = $2
          AND m.time >= to_timestamp($3) AND m.time < to_timestamp($4)
          AND m.value IS NOT NULL
        GROUP BY dow, hour
        ORDER BY dow, hour
        """,
        str(ctx["device_id"]), ctx["metric_id"],
        req.time_range.start, req.time_range.end,
    )

    x_labels = [f"{h:02d}" for h in range(24)]
    y_labels = WEEKDAY_LABELS

    # Build grid: data as [hour_index, weekday_index, value]
    grid: dict[tuple[int, int], float] = {}
    for row in rows:
        hour = int(row["hour"])
        dow = int(row["dow"]) - 1  # ISODOW: 1=Mon → index 0
        grid[(hour, dow)] = round(float(row["value"]), 4) if row["value"] is not None else None

    data = []
    all_values = []
    for hour in range(24):
        for dow in range(7):
            val = grid.get((hour, dow))
            data.append([hour, dow, val])
            if val is not None:
                all_values.append(val)

    elapsed = int((time.monotonic() - t0) * 1000)
    return HeatmapResponse(
        x_labels=x_labels,
        y_labels=y_labels,
        data=data,
        min_value=min(all_values) if all_values else None,
        max_value=max(all_values) if all_values else None,
        metric_point_id=req.metric_point_id,
        display_name=ctx.get("display_name"),
        unit=ctx.get("unit"),
        meta=ResponseMeta(computation_time_ms=elapsed, data_points_processed=len(rows)),
    )
