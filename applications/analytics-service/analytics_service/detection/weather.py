"""Outdoor-temperature client (Open-Meteo, public, no API key).

Cached per rounded coordinate (2 decimals, about 1 km) with a TTL, which
keeps the call frequency independent of the measurement rate: the AT-09
evaluation is minute-paced, not measurement-driven.

On failure the client returns None and the detector skips the evaluation —
no synthetic substitute values (gap semantics, thesis ch. 4.4.2 applies
analogously).
"""

import logging
import time

import httpx

from ..config import settings

log = logging.getLogger(__name__)


class WeatherClient:
    def __init__(self) -> None:
        self._client = httpx.AsyncClient(timeout=10.0)
        self._cache: dict[tuple[float, float], tuple[float, float | None]] = {}
        self._error_logged: set[tuple[float, float]] = set()

    async def close(self) -> None:
        await self._client.aclose()

    async def current_temperature(self, latitude: float, longitude: float) -> float | None:
        key = (round(latitude, 2), round(longitude, 2))
        now = time.monotonic()
        cached = self._cache.get(key)
        if cached is not None and now < cached[0]:
            return cached[1]

        temperature = await self._fetch(key[0], key[1])
        if temperature is not None:
            self._cache[key] = (now + settings.weather_cache_ttl_seconds, temperature)
            self._error_logged.discard(key)
        return temperature

    async def _fetch(self, latitude: float, longitude: float) -> float | None:
        try:
            response = await self._client.get(
                settings.weather_base_url,
                params={
                    "latitude": latitude,
                    "longitude": longitude,
                    "current": "temperature_2m",
                },
            )
            response.raise_for_status()
            return float(response.json()["current"]["temperature_2m"])
        except Exception as e:  # noqa: BLE001 — degrade to "no data"
            key = (latitude, longitude)
            if key not in self._error_logged:
                self._error_logged.add(key)
                log.warning("Weather lookup failed for %s: %s — skipping evaluations", key, e)
            return None
