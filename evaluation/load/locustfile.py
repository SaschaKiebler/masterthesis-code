"""Query-API load profile for the thesis evaluation (QS-PER-03, QS-SEC-01).

Runs OUTSIDE the cluster on purpose: real query load originates outside, and a
generator inside the cluster would compete with the very services under test
for pod resources. Point CORE_HOST / ANALYTICS_HOST at the LoadBalancer IPs
from infrastructure/kubernetes/eval/external-access.yaml (or at localhost for
the dev stack).

Traffic mix: two equally weighted user classes, so the load splits 50/50
between the core's dashboard reads and the analytics statistics queries —
QS-PER-03 addresses both APIs. Task weights inside each class approximate a
monitoring dashboard: frequent latest-value polling, occasional list and
detail views.

Rates are driven by constant_throughput, so requests per second stay fixed
per user regardless of response time: 50 users x 2/s = 100 req/s (QS-PER-03),
25 users x 2/s = 50 req/s (QS-SEC-01 background load).

    CORE_HOST=http://<core-lb>:8080 ANALYTICS_HOST=http://<analytics-lb>:8100 \
      locust -f locustfile.py --headless -u 50 -r 10 --run-time 10m \
      --csv ../results/qs-per-03-$(date +%Y%m%d)

Preconditions: platform up, mock fleet seeded (mock-service seed), some
telemetry ingested. The test aborts at start with a clear message otherwise.

The measured client-side p95 includes the WAN leg to the cluster. test_start
therefore measures a baseline RTT against analytics' unauthenticated /health
and logs it, so the WAN share is on record for ch. 6.2 (client-side numbers
are a conservative upper bound).
"""

import logging
import os
import random
import statistics
import time

import requests
from locust import HttpUser, constant_throughput, events, task

log = logging.getLogger("qsper03")

CORE_HOST = os.environ.get("CORE_HOST", "http://localhost:8080")
ANALYTICS_HOST = os.environ.get("ANALYTICS_HOST", "http://localhost:8100")
LOGIN_EMAIL = os.environ.get("LOGIN_EMAIL", "admin@local")
LOGIN_PASSWORD = os.environ.get("LOGIN_PASSWORD", "admin")
THROUGHPUT_PER_USER = float(os.environ.get("THROUGHPUT_PER_USER", "2.0"))
PROJECT_NAME = os.environ.get("PROJECT_NAME", "Mock Fleet")
TIMESERIES_WINDOW_S = int(os.environ.get("TIMESERIES_WINDOW_S", "3600"))

BASELINE_PROBES = 20

# Shared, harvested once in test_start; read-only afterwards.
harvest: dict = {"project_id": None, "metric_point_ids": []}


def _login(session: requests.Session) -> str:
    resp = session.post(
        f"{CORE_HOST}/api/v1/auth/login",
        json={"email": LOGIN_EMAIL, "password": LOGIN_PASSWORD},
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()["token"]


@events.test_start.add_listener
def on_test_start(environment, **kwargs):
    """Harvest ids once, measure the WAN baseline, fail fast when unseeded."""
    session = requests.Session()
    try:
        token = _login(session)
    except Exception as e:
        raise SystemExit(
            f"Login at {CORE_HOST} failed ({e}). Is the platform up and is "
            f"{LOGIN_EMAIL} the bootstrap admin?"
        )
    session.headers["Authorization"] = f"Bearer {token}"

    projects = session.get(f"{CORE_HOST}/api/v1/projects", timeout=10).json()["projects"]
    project = next((p for p in projects if p.get("name") == PROJECT_NAME), None)
    if project is None:
        raise SystemExit(
            f"Project '{PROJECT_NAME}' not found at {CORE_HOST}. Seed the mock "
            f"fleet first (mock-service seed) — the load profile reads its "
            f"metric points."
        )
    harvest["project_id"] = project["id"]

    points = session.get(
        f"{CORE_HOST}/api/v1/projects/{project['id']}/metric-points", timeout=30
    ).json()["metricPoints"]
    harvest["metric_point_ids"] = [p["id"] for p in points]
    if not harvest["metric_point_ids"]:
        raise SystemExit(
            f"Project '{PROJECT_NAME}' has no metric points — seed and ingest "
            f"before measuring."
        )

    # WAN baseline against the unauthenticated health probe: the share of the
    # client-side p95 that is transport, not platform.
    rtts = []
    for _ in range(BASELINE_PROBES):
        t0 = time.perf_counter()
        requests.get(f"{ANALYTICS_HOST}/health", timeout=10)
        rtts.append((time.perf_counter() - t0) * 1000)
    log.info(
        "harvested %d metric points from project '%s'; baseline RTT to %s: "
        "median %.1f ms, p95 %.1f ms (%d probes)",
        len(harvest["metric_point_ids"]), PROJECT_NAME, ANALYTICS_HOST,
        statistics.median(rtts),
        sorted(rtts)[max(0, int(len(rtts) * 0.95) - 1)],
        BASELINE_PROBES,
    )


class _AuthedUser(HttpUser):
    """Common login: one token per simulated user, valid 24 h, no re-login."""

    abstract = True
    wait_time = constant_throughput(THROUGHPUT_PER_USER)

    def on_start(self):
        session = requests.Session()
        token = _login(session)
        self.client.headers["Authorization"] = f"Bearer {token}"

    def _get(self, path: str, name: str):
        with self.client.get(path, name=name, catch_response=True) as resp:
            if resp.status_code != 200:
                resp.failure(f"HTTP {resp.status_code}")

    def _post(self, path: str, name: str, payload: dict):
        with self.client.post(path, name=name, json=payload, catch_response=True) as resp:
            if resp.status_code != 200:
                resp.failure(f"HTTP {resp.status_code}")


class CoreDashboardUser(_AuthedUser):
    """Dashboard reads against the core's REST API."""

    host = CORE_HOST
    weight = 1

    @task(4)
    def latest_values(self):
        self._get(
            f"/api/v1/projects/{harvest['project_id']}/latest-values",
            "core:latest-values",
        )

    @task(2)
    def project_health(self):
        self._get(f"/api/v1/projects/{harvest['project_id']}/health", "core:health")

    @task(2)
    def events(self):
        self._get(
            f"/api/v1/projects/{harvest['project_id']}/events?limit=50",
            "core:events",
        )

    @task(1)
    def list_projects(self):
        self._get("/api/v1/projects", "core:projects")

    @task(1)
    def dashboards(self):
        self._get(
            f"/api/v1/projects/{harvest['project_id']}/dashboards",
            "core:dashboards",
        )


class AnalyticsQueryUser(_AuthedUser):
    """Statistics queries against the analytics API (reads the measurement store)."""

    host = ANALYTICS_HOST
    weight = 1

    def _sample_ids(self, k: int) -> list[str]:
        ids = harvest["metric_point_ids"]
        return random.sample(ids, min(k, len(ids)))

    def _window(self) -> dict:
        now = int(time.time())
        return {"start": now - TIMESERIES_WINDOW_S, "end": now}

    @task(4)
    def latest(self):
        self._post(
            "/stats/latest",
            "analytics:latest",
            {"metric_point_ids": self._sample_ids(20)},
        )

    @task(3)
    def timeseries(self):
        self._post(
            "/stats/timeseries",
            "analytics:timeseries",
            {
                "metric_point_ids": self._sample_ids(5),
                "time_range": self._window(),
                "resample": "auto",
                "aggregation": "mean",
            },
        )

    @task(1)
    def descriptive(self):
        self._post(
            "/stats/descriptive",
            "analytics:descriptive",
            {"metric_point_ids": self._sample_ids(5), "time_range": self._window()},
        )

    @task(1)
    def ingest_rate(self):
        self._post(
            "/stats/ingest-rate",
            "analytics:ingest-rate",
            {"metric_point_ids": None, "window_minutes": 15},
        )
