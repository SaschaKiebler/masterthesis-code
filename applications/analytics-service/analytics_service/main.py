"""Analytics Service — FastAPI entrypoint."""

from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .auth import require_token
from .tenancy import require_tenant_scope
from .config import settings
from .db.pool import init_pools, close_pools
from .routers import descriptive, timeseries, regression, boxplot, compute, histogram, heatmap, live, series


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_pools()
    runner = None
    if settings.kafka_enabled:
        from .detection.runner import DetectionRunner

        runner = DetectionRunner()
        await runner.start()
    yield
    if runner is not None:
        await runner.stop()
    await close_pools()


app = FastAPI(
    title="Digital Demon Analytics",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs" if settings.analytics_expose_docs else None,
    redoc_url="/redoc" if settings.analytics_expose_docs else None,
    openapi_url="/openapi.json" if settings.analytics_expose_docs else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# All /stats routes require the platform's HS256 bearer token AND that the
# addressed channels belong to the caller's tenant. require_tenant_scope
# depends on require_token itself, so the order is fixed by the dependency
# graph rather than by this list's order. /health stays open.
_auth = [Depends(require_token), Depends(require_tenant_scope)]
app.include_router(descriptive.router, dependencies=_auth)
app.include_router(timeseries.router, dependencies=_auth)
app.include_router(regression.router, dependencies=_auth)
app.include_router(boxplot.router, dependencies=_auth)
app.include_router(compute.router, dependencies=_auth)
app.include_router(histogram.router, dependencies=_auth)
app.include_router(heatmap.router, dependencies=_auth)
app.include_router(live.router, dependencies=_auth)
app.include_router(series.router, dependencies=_auth)


@app.get("/health")
async def health():
    return {"status": "ok"}
