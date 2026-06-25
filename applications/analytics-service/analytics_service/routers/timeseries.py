import time
from collections import defaultdict

from fastapi import APIRouter, Depends
import asyncpg
import numpy as np

from ..db.pool import get_pool
from ..db.queries import (
    fetch_metric_point_context,
    fetch_timeseries,
    resolve_bucket,
)
from ..models.requests import TimeseriesRequest, DifferenceRequest
from ..models.responses import (
    TimeseriesResponse,
    TimeseriesSeries,
    TimeseriesPoint,
    DifferenceResponse,
    DifferenceSeries,
    ResponseMeta,
)

router = APIRouter(prefix="/stats", tags=["timeseries"])


def _rolling_average(values: list[TimeseriesPoint], window_seconds: int, bucket_seconds: int) -> list[TimeseriesPoint]:
    """Compute rolling average over a window of N buckets."""
    if not values or window_seconds <= 0:
        return []
    window_size = max(1, window_seconds // bucket_seconds)
    vals = np.array([v.value if v.value is not None else np.nan for v in values])
    # Simple moving average with nan handling
    kernel = np.ones(window_size) / window_size
    padded = np.pad(vals, (window_size - 1, 0), mode="constant", constant_values=np.nan)
    rolled = np.convolve(padded, kernel, mode="valid")
    return [
        TimeseriesPoint(time=values[i].time, value=None if np.isnan(rolled[i]) else round(float(rolled[i]), 4))
        for i in range(len(values))
    ]


def _parse_window_seconds(window: str) -> int:
    mapping = {"1h": 3600, "3h": 10800, "6h": 21600, "12h": 43200, "24h": 86400, "7d": 604800}
    return mapping.get(window, 86400)


@router.post("/timeseries", response_model=TimeseriesResponse)
async def timeseries(
    req: TimeseriesRequest,
    pool: asyncpg.Pool = Depends(get_pool),
) -> TimeseriesResponse:
    t0 = time.monotonic()

    mp_ctx = await fetch_metric_point_context(pool, req.metric_point_ids)
    mp_map = {(str(r["device_id"]), r["metric_id"]): r for r in mp_ctx}
    pairs = [(str(r["device_id"]), r["metric_id"]) for r in mp_ctx]

    bucket_seconds = resolve_bucket(req.resample, req.time_range.start, req.time_range.end)

    if not pairs:
        return TimeseriesResponse(
            series=[], bucket_seconds=bucket_seconds,
            meta=ResponseMeta(computation_time_ms=0, data_points_processed=0),
        )

    rows = await fetch_timeseries(
        pool, pairs, req.time_range.start, req.time_range.end,
        bucket_seconds, req.aggregation,
    )

    # Group rows by (device_id, metric_id)
    grouped: dict[tuple, list[TimeseriesPoint]] = defaultdict(list)
    for row in rows:
        key = (row["device_id"], row["metric_id"])
        grouped[key].append(TimeseriesPoint(
            time=int(row["bucket"]),
            value=round(float(row["value"]), 4) if row["value"] is not None else None,
        ))

    total_points = len(rows)
    series = []
    for (device_id, metric_id), points in grouped.items():
        ctx = mp_map.get((device_id, metric_id), {})
        rolling = None
        if req.rolling_window:
            rolling = _rolling_average(points, _parse_window_seconds(req.rolling_window), bucket_seconds)
        series.append(TimeseriesSeries(
            metric_point_id=str(ctx.get("id", "")),
            display_name=ctx.get("display_name"),
            unit=ctx.get("unit"),
            values=points,
            rolling_values=rolling,
        ))

    elapsed_ms = int((time.monotonic() - t0) * 1000)
    return TimeseriesResponse(
        series=series,
        bucket_seconds=bucket_seconds,
        meta=ResponseMeta(computation_time_ms=elapsed_ms, data_points_processed=total_points),
    )


@router.post("/difference", response_model=DifferenceResponse)
async def difference(
    req: DifferenceRequest,
    pool: asyncpg.Pool = Depends(get_pool),
) -> DifferenceResponse:
    """Compute A - B for two metric points, aligned by time bucket."""
    t0 = time.monotonic()

    mp_ctx = await fetch_metric_point_context(pool, [req.metric_point_id_a, req.metric_point_id_b])
    pairs = [(str(r["device_id"]), r["metric_id"]) for r in mp_ctx]
    bucket_seconds = resolve_bucket(req.resample, req.time_range.start, req.time_range.end)

    if len(pairs) < 2:
        return DifferenceResponse(
            difference=DifferenceSeries(label="A - B", values=[]),
            meta=ResponseMeta(computation_time_ms=0, data_points_processed=0),
        )

    rows = await fetch_timeseries(
        pool, pairs, req.time_range.start, req.time_range.end, bucket_seconds,
    )

    # Split into two series by device/metric
    mp_a = next((r for r in mp_ctx if str(r["id"]) == req.metric_point_id_a), None)
    mp_b = next((r for r in mp_ctx if str(r["id"]) == req.metric_point_id_b), None)

    series_a: dict[int, float] = {}
    series_b: dict[int, float] = {}
    for row in rows:
        t = int(row["bucket"])
        if mp_a and row["device_id"] == str(mp_a["device_id"]) and row["metric_id"] == mp_a["metric_id"]:
            series_a[t] = float(row["value"]) if row["value"] is not None else None
        elif mp_b and row["device_id"] == str(mp_b["device_id"]) and row["metric_id"] == mp_b["metric_id"]:
            series_b[t] = float(row["value"]) if row["value"] is not None else None

    # Compute difference at matching timestamps
    all_times = sorted(set(series_a.keys()) & set(series_b.keys()))
    diff_values = []
    for t in all_times:
        va, vb = series_a.get(t), series_b.get(t)
        val = round(va - vb, 4) if va is not None and vb is not None else None
        diff_values.append(TimeseriesPoint(time=t, value=val))

    elapsed_ms = int((time.monotonic() - t0) * 1000)
    return DifferenceResponse(
        difference=DifferenceSeries(label="A - B", values=diff_values),
        meta=ResponseMeta(computation_time_ms=elapsed_ms, data_points_processed=len(rows)),
    )
