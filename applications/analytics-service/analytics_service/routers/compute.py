"""
Generic compute endpoint — takes a chart definition with sources + calculations,
fetches data, computes all calculations server-side, returns ready-to-render series.
"""

import ast
import functools
import time
from collections import defaultdict

from fastapi import APIRouter, Depends
import asyncpg
import numpy as np

from ..db.pool import get_pool
from ..db.queries import fetch_metric_point_context, fetch_timeseries, resolve_bucket
from ..models.requests import TimeRange
from ..models.responses import ResponseMeta
from pydantic import BaseModel

router = APIRouter(prefix="/stats", tags=["compute"])


class ComputeSource(BaseModel):
    id: str
    metric_point_id: str


class ComputeCalculation(BaseModel):
    id: str
    type: str
    label: str
    color: str
    inputs: dict[str, str]  # source/calc IDs
    params: dict[str, object] | None = None


class ComputeRequest(BaseModel):
    sources: list[ComputeSource]
    calculations: list[ComputeCalculation]
    time_range: TimeRange
    resample: str = "auto"
    bucket_seconds: int | None = None  # explicit resolution, overrides resample


class ComputedSeries(BaseModel):
    id: str
    label: str
    color: str
    type: str  # "line", "band", "markers", "markline"
    data: list[list[float | None]]  # [[time_ms, value], ...]
    band_upper: list[list[float | None]] | None = None  # for bands
    mark_value: float | None = None  # for horizontal reference lines
    extra: dict[str, object] | None = None  # R², slope, etc.


class ComputeResponse(BaseModel):
    series: list[ComputedSeries]
    meta: ResponseMeta


def _rolling_avg(values: list[float | None], window: int) -> list[float | None]:
    result = []
    buf: list[float] = []
    for v in values:
        if v is not None:
            buf.append(v)
        if len(buf) > window:
            buf.pop(0)
        if len(buf) >= max(1, window // 2):
            result.append(round(sum(buf) / len(buf), 4))
        else:
            result.append(None)
    return result


# ─── Formula evaluation (safe AST subset) ───────────────────────────────────

_FORMULA_FUNCS: dict[str, object] = {
    "abs": np.abs,
    "sqrt": np.sqrt,
    "log": np.log,
    "exp": np.exp,
    "round": np.round,
    "min": lambda *args: functools.reduce(np.minimum, args),
    "max": lambda *args: functools.reduce(np.maximum, args),
}

_FORMULA_BINOPS = {
    ast.Add: np.add,
    ast.Sub: np.subtract,
    ast.Mult: np.multiply,
    ast.Div: np.divide,
    ast.Pow: np.power,
    ast.Mod: np.mod,
}


def _eval_formula_node(node: ast.AST, env: dict[str, np.ndarray]):
    if isinstance(node, ast.Expression):
        return _eval_formula_node(node.body, env)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)) and not isinstance(node.value, bool):
        return float(node.value)
    if isinstance(node, ast.Name):
        if node.id in env:
            return env[node.id]
        raise ValueError(f"unknown variable '{node.id}'")
    if isinstance(node, ast.BinOp) and type(node.op) in _FORMULA_BINOPS:
        left = _eval_formula_node(node.left, env)
        right = _eval_formula_node(node.right, env)
        return _FORMULA_BINOPS[type(node.op)](left, right)
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)):
        value = _eval_formula_node(node.operand, env)
        return -value if isinstance(node.op, ast.USub) else value
    if (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id in _FORMULA_FUNCS
        and not node.keywords
        and node.args
    ):
        args = [_eval_formula_node(a, env) for a in node.args]
        return _FORMULA_FUNCS[node.func.id](*args)
    raise ValueError(f"unsupported expression: {type(node).__name__}")


def _eval_formula(
    formula: str,
    inputs: dict[str, str],
    source_by_time: dict[str, dict[int, float]],
) -> list[list[float]]:
    """Evaluate a formula over the timestamps common to all referenced sources."""
    tree = ast.parse(formula, mode="eval")

    func_names = {n.func.id for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)}
    var_names = {n.id for n in ast.walk(tree) if isinstance(n, ast.Name)} - func_names

    common: set[int] | None = None
    var_times: dict[str, dict[int, float]] = {}
    for name in var_names:
        src_id = inputs.get(name, "")
        if src_id not in source_by_time:
            raise ValueError(f"variable '{name}' is not bound to a sensor")
        var_times[name] = source_by_time[src_id]
        keys = set(var_times[name].keys())
        common = keys if common is None else common & keys

    times = sorted(common or [])
    if not times:
        return []

    env = {name: np.array([tv[t] for t in times], dtype=float) for name, tv in var_times.items()}
    with np.errstate(divide="ignore", invalid="ignore", over="ignore"):
        result = np.asarray(_eval_formula_node(tree, env), dtype=float)
    if result.ndim == 0:
        result = np.full(len(times), float(result))

    return [[t * 1000, round(float(v), 4)] for t, v in zip(times, result) if np.isfinite(v)]


@router.post("/compute", response_model=ComputeResponse)
async def compute(
    req: ComputeRequest,
    pool: asyncpg.Pool = Depends(get_pool),
) -> ComputeResponse:
    t0 = time.monotonic()

    if not req.sources or not req.calculations:
        elapsed = int((time.monotonic() - t0) * 1000)
        return ComputeResponse(series=[], meta=ResponseMeta(computation_time_ms=elapsed, data_points_processed=0))

    # Resolve metric points
    mp_ids = [s.metric_point_id for s in req.sources]
    mp_ctx = await fetch_metric_point_context(pool, mp_ids)
    mp_map = {str(r["id"]): r for r in mp_ctx}

    pairs = [(str(r["device_id"]), r["metric_id"]) for r in mp_ctx]
    if req.bucket_seconds is not None:
        bucket_seconds = max(60, req.bucket_seconds)
    else:
        bucket_seconds = resolve_bucket(req.resample, req.time_range.start, req.time_range.end)

    # Fetch timeseries
    rows = await fetch_timeseries(pool, pairs, req.time_range.start, req.time_range.end, bucket_seconds)

    # Group by source ID
    source_data: dict[str, list[tuple[int, float]]] = {s.id: [] for s in req.sources}
    for row in rows:
        for src in req.sources:
            ctx = mp_map.get(src.metric_point_id)
            if ctx and row["device_id"] == str(ctx["device_id"]) and row["metric_id"] == ctx["metric_id"]:
                if row["value"] is not None:
                    source_data[src.id].append((int(row["bucket"]), float(row["value"])))
                break

    # Sort each source by time
    for sid in source_data:
        source_data[sid].sort(key=lambda x: x[0])

    # Build lookup: time → value per source
    source_by_time: dict[str, dict[int, float]] = {}
    for sid, points in source_data.items():
        source_by_time[sid] = {t: v for t, v in points}

    # Compute each calculation
    computed: list[ComputedSeries] = []

    for calc in req.calculations:
        try:
            if calc.type == "mean":
                src_id = calc.inputs.get("source", "")
                points = source_data.get(src_id, [])
                if points:
                    mean_val = round(sum(v for _, v in points) / len(points), 4)
                    # Return as horizontal markline
                    times = [t for t, _ in points]
                    computed.append(ComputedSeries(
                        id=calc.id, label=calc.label, color=calc.color, type="markline",
                        data=[[times[0] * 1000, mean_val], [times[-1] * 1000, mean_val]],
                        mark_value=mean_val,
                    ))

            elif calc.type == "median":
                src_id = calc.inputs.get("source", "")
                points = source_data.get(src_id, [])
                if points:
                    vals = sorted(v for _, v in points)
                    n = len(vals)
                    median_val = round(vals[n // 2] if n % 2 else (vals[n // 2 - 1] + vals[n // 2]) / 2, 4)
                    times = [t for t, _ in points]
                    computed.append(ComputedSeries(
                        id=calc.id, label=calc.label, color=calc.color, type="markline",
                        data=[[times[0] * 1000, median_val], [times[-1] * 1000, median_val]],
                        mark_value=median_val,
                    ))

            elif calc.type == "moving_average":
                src_id = calc.inputs.get("source", "")
                points = source_data.get(src_id, [])
                params = calc.params or {}
                window_str = str(params.get("window", "24h"))
                window_map = {"1h": 3600, "3h": 10800, "6h": 21600, "12h": 43200, "24h": 86400, "7d": 604800}
                window_secs = window_map.get(window_str, 86400)
                window_buckets = max(1, window_secs // bucket_seconds)

                if points:
                    values = [v for _, v in points]
                    rolled = _rolling_avg(values, window_buckets)
                    data = [[t * 1000, r] for (t, _), r in zip(points, rolled) if r is not None]
                    computed.append(ComputedSeries(
                        id=calc.id, label=calc.label, color=calc.color, type="line",
                        data=data,
                    ))

            elif calc.type == "difference":
                src_a = calc.inputs.get("a", "")
                src_b = calc.inputs.get("b", "")
                times_a = source_by_time.get(src_a, {})
                times_b = source_by_time.get(src_b, {})
                common = sorted(set(times_a.keys()) & set(times_b.keys()))
                data = [[t * 1000, round(times_a[t] - times_b[t], 4)] for t in common]
                computed.append(ComputedSeries(
                    id=calc.id, label=calc.label, color=calc.color, type="line",
                    data=data,
                ))

            elif calc.type == "formula":
                params = calc.params or {}
                formula = str(params.get("formula", "")).strip()
                if formula:
                    data = _eval_formula(formula, calc.inputs, source_by_time)
                    computed.append(ComputedSeries(
                        id=calc.id, label=calc.label, color=calc.color, type="line",
                        data=data,
                    ))

            elif calc.type == "min_max_band":
                src_id = calc.inputs.get("source", "")
                points = source_data.get(src_id, [])
                params = calc.params or {}
                window_str = str(params.get("window", "24h"))
                window_map = {"1h": 3600, "3h": 10800, "6h": 21600, "24h": 86400}
                window_secs = window_map.get(window_str, 86400)
                window_buckets = max(1, window_secs // bucket_seconds)

                if points:
                    values = [v for _, v in points]
                    lower, upper = [], []
                    for i in range(len(values)):
                        start_i = max(0, i - window_buckets + 1)
                        window = values[start_i:i + 1]
                        lower.append(round(min(window), 4))
                        upper.append(round(max(window), 4))
                    data_lower = [[t * 1000, l] for (t, _), l in zip(points, lower)]
                    data_upper = [[t * 1000, u] for (t, _), u in zip(points, upper)]
                    computed.append(ComputedSeries(
                        id=calc.id, label=calc.label, color=calc.color, type="band",
                        data=data_lower, band_upper=data_upper,
                    ))

            elif calc.type == "std_band":
                src_id = calc.inputs.get("source", "")
                points = source_data.get(src_id, [])
                params = calc.params or {}
                factor = float(params.get("factor", 1))
                if points:
                    vals = np.array([v for _, v in points])
                    mean = float(np.mean(vals))
                    std = float(np.std(vals))
                    lo = round(mean - factor * std, 4)
                    hi = round(mean + factor * std, 4)
                    times = [t for t, _ in points]
                    data_lower = [[t * 1000, lo] for t in times]
                    data_upper = [[t * 1000, hi] for t in times]
                    computed.append(ComputedSeries(
                        id=calc.id, label=f"{calc.label} (±{factor}σ)", color=calc.color, type="band",
                        data=data_lower, band_upper=data_upper,
                        extra={"mean": round(mean, 4), "std": round(std, 4)},
                    ))

            elif calc.type == "trend":
                src_id = calc.inputs.get("source", "")
                points = source_data.get(src_id, [])
                if len(points) >= 3:
                    times = np.array([t for t, _ in points], dtype=float)
                    vals = np.array([v for _, v in points])
                    coeffs = np.polyfit(times, vals, 1)
                    y_start = round(float(np.polyval(coeffs, times[0])), 4)
                    y_end = round(float(np.polyval(coeffs, times[-1])), 4)
                    computed.append(ComputedSeries(
                        id=calc.id, label=calc.label, color=calc.color, type="line",
                        data=[[int(times[0]) * 1000, y_start], [int(times[-1]) * 1000, y_end]],
                        extra={"slope_per_day": round(float(coeffs[0]) * 86400, 4)},
                    ))

            elif calc.type == "reference_line":
                params = calc.params or {}
                value = float(params.get("value", 0))
                # Use first source's time range for the line extent
                any_points = next((pts for pts in source_data.values() if pts), [])
                if any_points:
                    t_start = any_points[0][0]
                    t_end = any_points[-1][0]
                    computed.append(ComputedSeries(
                        id=calc.id, label=calc.label, color=calc.color, type="markline",
                        data=[[t_start * 1000, value], [t_end * 1000, value]],
                        mark_value=value,
                    ))

            elif calc.type == "regression":
                src_x = calc.inputs.get("x", calc.inputs.get("a", ""))
                src_y = calc.inputs.get("y", calc.inputs.get("b", ""))
                times_x = source_by_time.get(src_x, {})
                times_y = source_by_time.get(src_y, {})
                common = sorted(set(times_x.keys()) & set(times_y.keys()))
                if len(common) >= 3:
                    from scipy import stats as sp_stats
                    x_arr = np.array([times_x[t] for t in common])
                    y_arr = np.array([times_y[t] for t in common])
                    slope, intercept, r_value, _, _ = sp_stats.linregress(x_arr, y_arr)
                    computed.append(ComputedSeries(
                        id=calc.id, label=f"{calc.label} (R²={r_value**2:.3f})", color=calc.color, type="line",
                        data=[],
                        extra={"slope": round(float(slope), 4), "intercept": round(float(intercept), 4),
                               "r_squared": round(float(r_value ** 2), 4)},
                    ))

            # Register line results so later calculations can use them as inputs
            # (e.g. a trend over a formula result). Calculations are processed in
            # request order, so dependencies must come first.
            if computed and computed[-1].id == calc.id and computed[-1].type == "line" and computed[-1].data:
                pts = [(int(t // 1000), float(v)) for t, v in computed[-1].data if v is not None]
                source_data[calc.id] = pts
                source_by_time[calc.id] = dict(pts)

        except Exception as e:
            # Skip failed calculations, don't crash the whole request
            computed.append(ComputedSeries(
                id=calc.id, label=f"{calc.label} (error)", color="#666", type="line",
                data=[], extra={"error": str(e)},
            ))

    elapsed = int((time.monotonic() - t0) * 1000)
    return ComputeResponse(
        series=computed,
        meta=ResponseMeta(computation_time_ms=elapsed, data_points_processed=len(rows)),
    )
