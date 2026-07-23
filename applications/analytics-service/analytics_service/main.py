"""Analytics Service — FastAPI entrypoint."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .db.pool import init_pool, close_pool
from .routers import descriptive, timeseries, regression, boxplot, compute, histogram, heatmap, live


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_pool()
    runner = None
    if settings.kafka_enabled:
        from .detection.runner import DetectionRunner

        runner = DetectionRunner()
        await runner.start()
    yield
    if runner is not None:
        await runner.stop()
    await close_pool()


app = FastAPI(
    title="Digital Demon Analytics",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(descriptive.router)
app.include_router(timeseries.router)
app.include_router(regression.router)
app.include_router(boxplot.router)
app.include_router(compute.router)
app.include_router(histogram.router)
app.include_router(heatmap.router)
app.include_router(live.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
