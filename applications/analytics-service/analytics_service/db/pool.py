"""Two connection pools since the store split (thesis ch. 4.4.6):

- measurement pool → TimescaleDB (measurements, ingestion_errors); the hot
  data path, analytics is the single reader of this store.
- registry pool → master-data PostgreSQL (metric_points, objects, links,
  physical_quantities); read-only, used by transitional endpoints that still
  resolve metric-point ids themselves. Channel-based endpoints (/stats/series)
  receive channels from the caller and never touch it.
"""

import asyncpg

from ..config import settings

_measurement_pool: asyncpg.Pool | None = None
_registry_pool: asyncpg.Pool | None = None


async def get_pool() -> asyncpg.Pool:
    """The measurement pool — kept under the historic name because every
    data-path query uses it."""
    if _measurement_pool is None:
        raise RuntimeError("Database pools not initialized")
    return _measurement_pool


get_measurement_pool = get_pool


async def get_registry_pool() -> asyncpg.Pool:
    if _registry_pool is None:
        raise RuntimeError("Database pools not initialized")
    return _registry_pool


async def init_pools() -> None:
    global _measurement_pool, _registry_pool
    _measurement_pool = await asyncpg.create_pool(
        dsn=settings.database_url,
        min_size=settings.db_min_pool,
        max_size=settings.db_max_pool,
        command_timeout=60,
    )
    _registry_pool = await asyncpg.create_pool(
        dsn=settings.registry_database_url,
        min_size=1,
        max_size=settings.db_max_pool,
        command_timeout=60,
    )


async def close_pools() -> None:
    global _measurement_pool, _registry_pool
    if _measurement_pool:
        await _measurement_pool.close()
        _measurement_pool = None
    if _registry_pool:
        await _registry_pool.close()
        _registry_pool = None
