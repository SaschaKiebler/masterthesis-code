import time
from collections import defaultdict

from fastapi import APIRouter, Depends
import asyncpg
import numpy as np
from scipy import stats as sp_stats

from ..db.pool import get_pool
from ..db.queries import fetch_metric_point_context, fetch_timeseries, resolve_bucket
from ..models.requests import TimeRange
from ..models.responses import ResponseMeta
from pydantic import BaseModel

router = APIRouter(prefix="/stats", tags=["regression"])


class RegressionRequest(BaseModel):
    x_metric_point_id: str
    y_metric_point_id: str
    time_range: TimeRange
    resample: str = "auto"
    confidence_level: float = 0.95


class ConfidenceBand(BaseModel):
    x: list[float]
    y_lower: list[float]
    y_upper: list[float]


class RegressionResponse(BaseModel):
    slope: float
    intercept: float
    r_squared: float
    pearson_r: float
    p_value: float
    std_err: float
    n_points: int
    x_label: str | None
    y_label: str | None
    scatter: list[list[float]]  # [[x, y], ...]
    regression_line: list[list[float]]  # [[x, y], [x, y]]
    confidence_band: ConfidenceBand | None
    meta: ResponseMeta


@router.post("/regression", response_model=RegressionResponse)
async def regression(
    req: RegressionRequest,
    pool: asyncpg.Pool = Depends(get_pool),
) -> RegressionResponse:
    t0 = time.monotonic()

    mp_ctx = await fetch_metric_point_context(pool, [req.x_metric_point_id, req.y_metric_point_id])
    mp_x = next((r for r in mp_ctx if str(r["id"]) == req.x_metric_point_id), None)
    mp_y = next((r for r in mp_ctx if str(r["id"]) == req.y_metric_point_id), None)

    if not mp_x or not mp_y:
        elapsed = int((time.monotonic() - t0) * 1000)
        return RegressionResponse(
            slope=0, intercept=0, r_squared=0, pearson_r=0, p_value=1, std_err=0,
            n_points=0, x_label=None, y_label=None, scatter=[], regression_line=[],
            confidence_band=None, meta=ResponseMeta(computation_time_ms=elapsed, data_points_processed=0),
        )

    pairs = [(str(mp_x["device_id"]), mp_x["metric_id"]), (str(mp_y["device_id"]), mp_y["metric_id"])]
    bucket_seconds = resolve_bucket(req.resample, req.time_range.start, req.time_range.end)

    rows = await fetch_timeseries(pool, pairs, req.time_range.start, req.time_range.end, bucket_seconds)

    # Split into x/y series by timestamp
    x_by_time: dict[int, float] = {}
    y_by_time: dict[int, float] = {}
    for row in rows:
        t = int(row["bucket"])
        if row["value"] is None:
            continue
        if row["device_id"] == str(mp_x["device_id"]) and row["metric_id"] == mp_x["metric_id"]:
            x_by_time[t] = float(row["value"])
        elif row["device_id"] == str(mp_y["device_id"]) and row["metric_id"] == mp_y["metric_id"]:
            y_by_time[t] = float(row["value"])

    # Match timestamps
    common_times = sorted(set(x_by_time.keys()) & set(y_by_time.keys()))
    if len(common_times) < 3:
        elapsed = int((time.monotonic() - t0) * 1000)
        scatter = [[x_by_time[t], y_by_time[t]] for t in common_times]
        return RegressionResponse(
            slope=0, intercept=0, r_squared=0, pearson_r=0, p_value=1, std_err=0,
            n_points=len(common_times), x_label=mp_x.get("display_name"), y_label=mp_y.get("display_name"),
            scatter=scatter, regression_line=[], confidence_band=None,
            meta=ResponseMeta(computation_time_ms=elapsed, data_points_processed=len(rows)),
        )

    x_arr = np.array([x_by_time[t] for t in common_times])
    y_arr = np.array([y_by_time[t] for t in common_times])

    slope, intercept, r_value, p_value, std_err = sp_stats.linregress(x_arr, y_arr)

    # Scatter points
    scatter = [[round(float(x), 4), round(float(y), 4)] for x, y in zip(x_arr, y_arr)]

    # Regression line endpoints
    x_min, x_max = float(np.min(x_arr)), float(np.max(x_arr))
    regression_line = [
        [round(x_min, 4), round(slope * x_min + intercept, 4)],
        [round(x_max, 4), round(slope * x_max + intercept, 4)],
    ]

    # Confidence band
    confidence_band = None
    if len(common_times) > 10:
        n = len(x_arr)
        x_mean = np.mean(x_arr)
        se_y = np.sqrt(np.sum((y_arr - (slope * x_arr + intercept)) ** 2) / (n - 2))
        t_val = sp_stats.t.ppf((1 + req.confidence_level) / 2, n - 2)

        x_band = np.linspace(x_min, x_max, 50)
        y_pred = slope * x_band + intercept
        se_pred = se_y * np.sqrt(1 / n + (x_band - x_mean) ** 2 / np.sum((x_arr - x_mean) ** 2))

        confidence_band = ConfidenceBand(
            x=[round(float(v), 4) for v in x_band],
            y_lower=[round(float(v), 4) for v in (y_pred - t_val * se_pred)],
            y_upper=[round(float(v), 4) for v in (y_pred + t_val * se_pred)],
        )

    elapsed = int((time.monotonic() - t0) * 1000)
    return RegressionResponse(
        slope=round(float(slope), 6),
        intercept=round(float(intercept), 4),
        r_squared=round(float(r_value ** 2), 4),
        pearson_r=round(float(r_value), 4),
        p_value=float(p_value),
        std_err=round(float(std_err), 6),
        n_points=len(common_times),
        x_label=mp_x.get("display_name"),
        y_label=mp_y.get("display_name"),
        scatter=scatter,
        regression_line=regression_line,
        confidence_band=confidence_band,
        meta=ResponseMeta(computation_time_ms=elapsed, data_points_processed=len(rows)),
    )
