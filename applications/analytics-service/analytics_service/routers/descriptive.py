import time

from fastapi import APIRouter, Depends
import asyncpg

from ..db.pool import get_pool
from ..db.queries import fetch_metric_point_context, fetch_descriptive_stats
from ..models.requests import DescriptiveRequest
from ..models.responses import DescriptiveResponse, MetricStats, ResponseMeta

router = APIRouter(prefix="/stats", tags=["statistics"])


@router.post("/descriptive", response_model=DescriptiveResponse)
async def descriptive_stats(
    req: DescriptiveRequest,
    pool: asyncpg.Pool = Depends(get_pool),
) -> DescriptiveResponse:
    t0 = time.monotonic()

    # Resolve metric point IDs → device_id + metric_id
    mp_ctx = await fetch_metric_point_context(pool, req.metric_point_ids)
    mp_map = {(str(r["device_id"]), r["metric_id"]): r for r in mp_ctx}
    pairs = [(str(r["device_id"]), r["metric_id"]) for r in mp_ctx]

    if not pairs:
        return DescriptiveResponse(
            metrics=[],
            meta=ResponseMeta(computation_time_ms=0, data_points_processed=0),
        )

    rows = await fetch_descriptive_stats(pool, pairs, req.time_range.start, req.time_range.end)

    total_points = 0
    metrics = []
    for row in rows:
        key = (row["device_id"], row["metric_id"])
        ctx = mp_map.get(key, {})
        total_points += row["count"]
        metrics.append(MetricStats(
            metric_point_id=str(ctx.get("id", "")),
            device_id=row["device_id"],
            metric_id=row["metric_id"],
            display_name=ctx.get("display_name"),
            unit=ctx.get("unit"),
            count=row["count"],
            mean=float(row["mean"]),
            median=float(row["median"]),
            std=float(row["std"]),
            min=float(row["min"]),
            max=float(row["max"]),
            q25=float(row["q25"]),
            q75=float(row["q75"]),
            iqr=float(row["q75"]) - float(row["q25"]),
        ))

    elapsed_ms = int((time.monotonic() - t0) * 1000)
    return DescriptiveResponse(
        metrics=metrics,
        meta=ResponseMeta(computation_time_ms=elapsed_ms, data_points_processed=total_points),
    )
