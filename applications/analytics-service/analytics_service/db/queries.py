"""SQL queries for analytics — push aggregation into TimescaleDB where possible."""

import asyncpg


def _auto_bucket_seconds(start: int, end: int) -> int:
    span = end - start
    if span <= 21600:      # ≤ 6h
        return 60          # 1min
    if span <= 172800:     # ≤ 2d
        return 300          # 5min
    if span <= 604800:     # ≤ 7d
        return 900          # 15min
    if span <= 2592000:    # ≤ 30d
        return 3600         # 1h
    if span <= 7776000:    # ≤ 90d
        return 21600        # 6h
    return 86400            # 1d


def resolve_bucket(resample: str, start: int, end: int) -> int:
    if resample == "auto":
        return _auto_bucket_seconds(start, end)
    mapping = {
        "1min": 60, "5min": 300, "15min": 900,
        "1h": 3600, "6h": 21600, "1d": 86400,
    }
    return mapping.get(resample, _auto_bucket_seconds(start, end))


async def fetch_metric_point_context(
    pool: asyncpg.Pool,
    metric_point_ids: list[str],
) -> list[dict]:
    """Resolve metric point IDs to device_id, metric_id, display_name, unit.

    Registry lookup — reads the master-data store, NOT the measurement store.
    The passed pool argument is ignored since the store split; the registry
    pool is acquired internally so the transitional callers stay unchanged.
    """
    from .pool import get_registry_pool

    pool = await get_registry_pool()
    rows = await pool.fetch(
        """
        SELECT mp.id, mp.device_id, mp.metric_id, o.display_name, mp.unit
        FROM metric_points mp
        JOIN objects o ON o.id = mp.id
        WHERE mp.id = ANY($1::uuid[])
        """,
        metric_point_ids,
    )
    return [dict(r) for r in rows]


async def fetch_descriptive_stats(
    pool: asyncpg.Pool,
    device_metric_pairs: list[tuple[str, int]],
    start: int,
    end: int,
) -> list[dict]:
    """Compute descriptive statistics in SQL using TimescaleDB."""
    # Build filter arrays
    device_ids = [d for d, _ in device_metric_pairs]
    metric_ids = [m for _, m in device_metric_pairs]

    rows = await pool.fetch(
        """
        WITH pairs AS (
            SELECT unnest($1::text[]) AS device_id, unnest($2::int[]) AS metric_id
        )
        SELECT
            m.device_id,
            m.metric_id,
            COUNT(*)::int AS count,
            AVG(m.value) AS mean,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY m.value) AS median,
            COALESCE(STDDEV(m.value), 0) AS std,
            MIN(m.value) AS min,
            MAX(m.value) AS max,
            PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY m.value) AS q25,
            PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY m.value) AS q75
        FROM measurements m
        JOIN pairs p ON m.device_id = p.device_id AND m.metric_id = p.metric_id
        WHERE m.time >= to_timestamp($3) AND m.time < to_timestamp($4)
        GROUP BY m.device_id, m.metric_id
        """,
        device_ids, metric_ids, start, end,
    )
    return [dict(r) for r in rows]


async def fetch_raw_timeseries(
    pool: asyncpg.Pool,
    device_metric_pairs: list[tuple[str, int]],
    start: int,
    end: int,
) -> list[dict]:
    """Every individual data point (no bucketing) — state-change widgets need
    the exact transitions that aggregation would smear."""
    device_ids = [d for d, _ in device_metric_pairs]
    metric_ids = [m for _, m in device_metric_pairs]

    rows = await pool.fetch(
        """
        WITH pairs AS (
            SELECT unnest($1::text[]) AS device_id, unnest($2::int[]) AS metric_id
        )
        SELECT
            EXTRACT(EPOCH FROM m.time)::bigint AS bucket,
            m.device_id,
            m.metric_id,
            m.value
        FROM measurements m
        JOIN pairs p ON m.device_id = p.device_id AND m.metric_id = p.metric_id
        WHERE m.time >= to_timestamp($3) AND m.time < to_timestamp($4)
        ORDER BY bucket
        """,
        device_ids, metric_ids, start, end,
    )
    return [dict(r) for r in rows]


async def fetch_timeseries(
    pool: asyncpg.Pool,
    device_metric_pairs: list[tuple[str, int]],
    start: int,
    end: int,
    bucket_seconds: int,
    aggregation: str = "mean",
) -> list[dict]:
    """Fetch time-bucketed measurements for multiple device/metric pairs."""
    device_ids = [d for d, _ in device_metric_pairs]
    metric_ids = [m for _, m in device_metric_pairs]

    agg_fn = {
        "mean": "AVG", "min": "MIN", "max": "MAX", "sum": "SUM",
    }.get(aggregation, "AVG")

    rows = await pool.fetch(
        f"""
        WITH pairs AS (
            SELECT unnest($1::text[]) AS device_id, unnest($2::int[]) AS metric_id
        )
        SELECT
            EXTRACT(EPOCH FROM time_bucket(make_interval(secs => $5), m.time))::bigint AS bucket,
            m.device_id,
            m.metric_id,
            {agg_fn}(m.value) AS value
        FROM measurements m
        JOIN pairs p ON m.device_id = p.device_id AND m.metric_id = p.metric_id
        WHERE m.time >= to_timestamp($3) AND m.time < to_timestamp($4)
        GROUP BY bucket, m.device_id, m.metric_id
        ORDER BY bucket
        """,
        device_ids, metric_ids, start, end, float(bucket_seconds),
    )
    return [dict(r) for r in rows]
