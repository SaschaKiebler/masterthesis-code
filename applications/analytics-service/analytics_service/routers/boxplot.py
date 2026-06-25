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

router = APIRouter(prefix="/stats", tags=["boxplot"])

WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


class BoxplotRequest(BaseModel):
    metric_point_ids: list[str]
    time_range: TimeRange
    group_by: str = "weekday"  # "hour" | "weekday" | "month"


class BoxplotSeriesData(BaseModel):
    metric_point_id: str
    display_name: str | None
    unit: str | None
    boxplot_data: list[list[float]]  # [[min, q1, median, q3, max], ...]
    outliers: list[list[float]]  # [[group_index, value], ...]


class BoxplotResponse(BaseModel):
    categories: list[str]
    series: list[BoxplotSeriesData]
    meta: ResponseMeta


def _compute_boxplot(values: list[float]) -> tuple[list[float], list[float]]:
    """Returns ([min, q1, median, q3, max], [outlier_values])."""
    if not values:
        return [0, 0, 0, 0, 0], []
    arr = np.array(values)
    q1, median, q3 = np.percentile(arr, [25, 50, 75])
    iqr = q3 - q1
    lower_fence = q1 - 1.5 * iqr
    upper_fence = q3 + 1.5 * iqr
    whisker_low = float(np.min(arr[arr >= lower_fence])) if np.any(arr >= lower_fence) else float(q1)
    whisker_high = float(np.max(arr[arr <= upper_fence])) if np.any(arr <= upper_fence) else float(q3)
    outliers = arr[(arr < lower_fence) | (arr > upper_fence)].tolist()
    return [round(whisker_low, 4), round(float(q1), 4), round(float(median), 4),
            round(float(q3), 4), round(whisker_high, 4)], [round(float(o), 4) for o in outliers]


@router.post("/boxplot", response_model=BoxplotResponse)
async def boxplot(
    req: BoxplotRequest,
    pool: asyncpg.Pool = Depends(get_pool),
) -> BoxplotResponse:
    t0 = time.monotonic()

    mp_ctx = await fetch_metric_point_context(pool, req.metric_point_ids)
    if not mp_ctx:
        elapsed = int((time.monotonic() - t0) * 1000)
        return BoxplotResponse(categories=[], series=[], meta=ResponseMeta(computation_time_ms=elapsed, data_points_processed=0))

    # Build group extraction SQL based on group_by
    group_expr = {
        "hour": "EXTRACT(HOUR FROM m.time)::int",
        "weekday": "EXTRACT(ISODOW FROM m.time)::int",  # 1=Mon, 7=Sun
        "month": "EXTRACT(MONTH FROM m.time)::int",
    }.get(req.group_by, "EXTRACT(ISODOW FROM m.time)::int")

    device_ids = [str(r["device_id"]) for r in mp_ctx]
    metric_ids = [r["metric_id"] for r in mp_ctx]

    rows = await pool.fetch(
        f"""
        WITH pairs AS (
            SELECT unnest($1::text[]) AS device_id, unnest($2::int[]) AS metric_id
        )
        SELECT
            m.device_id,
            m.metric_id,
            {group_expr} AS grp,
            m.value
        FROM measurements m
        JOIN pairs p ON m.device_id = p.device_id AND m.metric_id = p.metric_id
        WHERE m.time >= to_timestamp($3) AND m.time < to_timestamp($4)
          AND m.value IS NOT NULL
        ORDER BY grp
        """,
        device_ids, metric_ids, req.time_range.start, req.time_range.end,
    )

    # Determine categories
    if req.group_by == "hour":
        categories = [f"{h:02d}:00" for h in range(24)]
        num_groups = 24
        group_offset = 0
    elif req.group_by == "month":
        categories = MONTH_LABELS
        num_groups = 12
        group_offset = 1  # EXTRACT(MONTH) is 1-based
    else:  # weekday
        categories = WEEKDAY_LABELS
        num_groups = 7
        group_offset = 1  # ISODOW is 1-based

    # Group values by (device_id, metric_id, group)
    mp_map = {(str(r["device_id"]), r["metric_id"]): r for r in mp_ctx}
    grouped: dict[tuple, dict[int, list[float]]] = defaultdict(lambda: defaultdict(list))

    for row in rows:
        key = (row["device_id"], row["metric_id"])
        grp = int(row["grp"])
        grouped[key][grp].append(float(row["value"]))

    # Build series
    series = []
    for (device_id, metric_id), groups in grouped.items():
        ctx = mp_map.get((device_id, metric_id), {})
        boxplot_data = []
        all_outliers = []

        for i in range(num_groups):
            grp_key = i + group_offset if group_offset else i
            values = groups.get(grp_key, [])
            if values:
                bp, outliers = _compute_boxplot(values)
                boxplot_data.append(bp)
                all_outliers.extend([[i, o] for o in outliers])
            else:
                boxplot_data.append([0, 0, 0, 0, 0])

        series.append(BoxplotSeriesData(
            metric_point_id=str(ctx.get("id", "")),
            display_name=ctx.get("display_name"),
            unit=ctx.get("unit"),
            boxplot_data=boxplot_data,
            outliers=all_outliers,
        ))

    elapsed = int((time.monotonic() - t0) * 1000)
    return BoxplotResponse(
        categories=categories,
        series=series,
        meta=ResponseMeta(computation_time_ms=elapsed, data_points_processed=len(rows)),
    )
