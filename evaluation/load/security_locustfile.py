"""QS-SEC-01 under load: cross-tenant attacks through the frontend proxy.

Two things make this file the honest QS-SEC-01 generator rather than a repeat
of the earlier tenant_isolation_probe.py:

  1. It logs in as a TENANT-BOUND user (probe-tenanta), never the bootstrap
     admin. A system admin short-circuits the tenant check on its first line,
     so a run as admin would report enforcement as free. The attacker here is
     an ordinary viewer of tenant A going after tenant B's data.

  2. It talks ONLY to the frontend proxy, the platform's single external
     surface. No backend microservice is reachable from outside, exactly as in
     production. Reads go to  /api/v1/*  and  /api/analytics/*  ; the proxy
     attaches the session cookie as a Bearer token and forwards to core and
     analytics, where the tenant check actually runs.

The target tenant's identifiers are not harvested (an attacker cannot read
them either). They are DERIVED from the seed recipe: mock-service builds every
id as uuid5 over "<prefix>:<kind>:...", so the whole attack surface of tenant B
follows from its prefix and fleet shape. That is the realistic case, an
attacker who knows or guesses an id and tries it.

Catalogue and pass/fail, organised by the OWASP API Security Top 10 (2023),
which is what the thesis cites for the choice of attack patterns:

  API1  Broken Object Level Authorization (BOLA) — ask for tenant B's objects,
        projects, metric points and analytics series by id. The core case.
  API2  Broken Authentication — no token, a malformed token, a token with a
        valid body but a wrong signature. Every one must be refused with 401.
  API3  Broken Object Property Level Authorization — list endpoints must filter
        tenant B out of the collection rather than expose it.
  API5  Broken Function Level Authorization (BFLA) — a viewer attempts writes
        and privileged reads on tenant B (opt-in, destructive, see below).

Outcome of a single attempt:

  DENIED     401 or 403                      -> pass, enforcement refused
  NOT_FOUND  404                             -> pass, nothing handed back
  FILTERED   2xx and NO tenant-B id in body  -> pass, the query was narrowed
  LEAK       2xx and a tenant-B id in body   -> FAILURE, the response measure
  BAD_INPUT  400 or 422                      -> FAILURE of THIS script, not the
                                               platform; must be zero in a run
                                               that gets reported
  ERROR      5xx or transport                -> FAILURE, counted apart

Locust's failure count is therefore the QS-SEC-01 leak count, and the per-name
stats table is the coverage map (one row per OWASP-tagged attack pattern). The
sustained rate is the scenario's parallel base load: at -u 25 and two requests
per user per second the attacks themselves offer 50 requests/s, so no separate
legitimate generator is needed.

Writes (API5) are destructive on tenant B's synthetic fixtures and are OFF by
default. Set INCLUDE_WRITES=true to add them, and reseed tenant B afterwards.

Environment:
  FRONTEND_HOST     default http://localhost:3000  (the ONLY host used)
  LOGIN_EMAIL       default probe-tenanta@example.org
  LOGIN_PASSWORD    default probe-pw-2026
  TARGET_PREFIX     default tenantb   (whose ids are derived and attacked)
  TARGET_SITES      default 2         (must match tenant B's seed)
  TARGET_ROOMS      default 2
  TARGET_PERSONS    default 0         (>0 only if tenant B was seeded --persons)
  INCLUDE_WRITES    default false
  THROUGHPUT_PER_USER default 2.0

Run (through the proxy, as a Cloud Run job or locally):
  FRONTEND_HOST=http://<frontend>:3000 \
    locust -f security_locustfile.py --headless -u 25 -r 5 --run-time 10m \
    --csv qs-sec-01
"""

import hashlib
import hmac
import json
import logging
import os
import time
import uuid
from base64 import urlsafe_b64encode
from collections import Counter

import requests
from locust import HttpUser, constant_throughput, events, task

log = logging.getLogger("qssec01")

FRONTEND_HOST = os.environ.get("FRONTEND_HOST", "http://localhost:3000").rstrip("/")
LOGIN_EMAIL = os.environ.get("LOGIN_EMAIL", "probe-tenanta@example.org")
LOGIN_PASSWORD = os.environ.get("LOGIN_PASSWORD", "probe-pw-2026")
TARGET_PREFIX = os.environ.get("TARGET_PREFIX", "tenantb")
TARGET_SITES = int(os.environ.get("TARGET_SITES", "2"))
TARGET_ROOMS = int(os.environ.get("TARGET_ROOMS", "2"))
TARGET_PERSONS = int(os.environ.get("TARGET_PERSONS", "0"))
INCLUDE_WRITES = os.environ.get("INCLUDE_WRITES", "false").lower() == "true"
THROUGHPUT_PER_USER = float(os.environ.get("THROUGHPUT_PER_USER", "2.0"))

# Same namespace mock-service uses for every uuid5, so tenant B's ids need no
# lookup. See applications/mock-service/src/mock_service/fleet.py.
UUID_NS = uuid.uuid5(uuid.NAMESPACE_URL, "digitaldemon:mock-service")

BOILER_METRIC_IDS = (1, 2, 3, 4)   # flow, return, power, pump
HT_METRIC_IDS = (1, 2, 3)          # temperature, humidity, battery


# ── Target derivation ────────────────────────────────────────────────────────

def _u5(name: str) -> str:
    return str(uuid.uuid5(UUID_NS, name))


class Target:
    """Tenant B's identifiers, all derived from its prefix and fleet shape."""

    def __init__(self, prefix: str, sites: int, rooms: int, persons: int):
        self.prefix = prefix
        self.tenant_id = _u5(f"{prefix}:tenant")
        self.project_id = _u5(f"{prefix}:project")

        self.building_ids: list[str] = []
        self.device_ids: list[str] = []
        self.device_object_ids: list[str] = []
        self.asset_object_ids: list[str] = []
        self.metric_point_ids: list[str] = []
        self.person_ids: list[str] = []

        for site in range(1, sites + 1):
            self.building_ids.append(_u5(f"{prefix}:building:{site:03d}"))
            self._add_device(f"{prefix}-boiler-{site:03d}", BOILER_METRIC_IDS)
            for room in range(1, rooms + 1):
                self._add_device(f"{prefix}-ht-{site:03d}-{room:02d}", HT_METRIC_IDS)
            for i in range(1, persons + 1):
                self.person_ids.append(_u5(f"{prefix}:person:{site:03d}:{i:02d}"))

    def _add_device(self, device_id: str, metric_ids) -> None:
        self.device_ids.append(device_id)
        self.device_object_ids.append(_u5(f"{self.prefix}:device:{device_id}"))
        self.asset_object_ids.append(_u5(f"{self.prefix}:asset:{device_id}"))
        for m in metric_ids:
            self.metric_point_ids.append(_u5(f"{self.prefix}:metric:{device_id}:{m}"))

    def identifiers(self) -> list[str]:
        """Any of these in a response body is a leak of tenant B."""
        ids = [self.tenant_id, self.project_id]
        ids += self.building_ids + self.device_ids + self.device_object_ids
        ids += self.asset_object_ids + self.metric_point_ids + self.person_ids
        return ids


TARGET = Target(TARGET_PREFIX, TARGET_SITES, TARGET_ROOMS, TARGET_PERSONS)
FOREIGN_IDS = TARGET.identifiers()


# ── Classification ───────────────────────────────────────────────────────────

def classify(status: int, body: str, write: bool) -> str:
    if status in (401, 403):
        return "DENIED"
    if status == 404:
        return "NOT_FOUND"
    if status in (400, 422):
        return "BAD_INPUT"
    if status >= 500 or status == 0:
        return "ERROR"
    if 200 <= status < 300:
        # A write that was not refused is a leak regardless of body: it acted
        # on tenant B. A read leaks only if a tenant-B id comes back.
        if write:
            return "LEAK"
        return "LEAK" if any(i in body for i in FOREIGN_IDS) else "FILTERED"
    return "ERROR"


PASS = {"DENIED", "NOT_FOUND", "FILTERED"}
_counts: Counter = Counter()
_leaks: list[str] = []


def _record(outcome: str, name: str) -> None:
    _counts[outcome] += 1
    if outcome == "LEAK":
        _leaks.append(name)


# ── Crafted tokens for API2 (no real secret needed) ──────────────────────────

def _b64(raw: bytes) -> str:
    return urlsafe_b64encode(raw).rstrip(b"=").decode()


def _jwt(secret: str, claims: dict) -> str:
    header = _b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = _b64(json.dumps(claims).encode())
    signing_input = f"{header}.{payload}".encode()
    sig = _b64(hmac.new(secret.encode(), signing_input, hashlib.sha256).digest())
    return f"{header}.{payload}.{sig}"


def _wrong_signature_token() -> str:
    # Well-formed claims, but signed with a key the platform does not hold.
    claims = {"sub": "local|attacker@example.org", "exp": int(time.time()) + 3600}
    return _jwt("a-key-the-platform-does-not-have", claims)


# ── Login ────────────────────────────────────────────────────────────────────

@events.test_start.add_listener
def on_test_start(environment, **_):
    """One login proves the credentials and the proxy path before the run."""
    if LOGIN_EMAIL == "admin@local":
        raise SystemExit(
            "Refusing to run QS-SEC-01 as admin@local: a system admin bypasses "
            "the tenant check, so the run would report enforcement as free. Use "
            "the tenant-bound probe user (LOGIN_EMAIL=probe-tenanta@example.org)."
        )
    s = requests.Session()
    try:
        r = s.post(f"{FRONTEND_HOST}/api/auth/login",
                   json={"email": LOGIN_EMAIL, "password": LOGIN_PASSWORD}, timeout=10)
    except Exception as e:  # noqa: BLE001
        raise SystemExit(f"login at {FRONTEND_HOST}/api/auth/login failed: {e}. "
                         f"Is the frontend proxy reachable?")
    if r.status_code != 200:
        raise SystemExit(f"login as {LOGIN_EMAIL} failed: HTTP {r.status_code} {r.text[:200]}")
    log.info("attacker %s logged in via the proxy; targeting %d ids of tenant '%s' "
             "(writes %s)", LOGIN_EMAIL, len(FOREIGN_IDS), TARGET_PREFIX,
             "ON" if INCLUDE_WRITES else "off")


@events.quitting.add_listener
def on_quitting(environment, **_):
    total = sum(_counts.values())
    log.info("QS-SEC-01 outcomes over %d attempts: %s", total,
             ", ".join(f"{k}={v}" for k, v in sorted(_counts.items())))
    if _leaks:
        log.error("LEAKS (%d): %s", len(_leaks), ", ".join(sorted(set(_leaks))))
        environment.process_exit_code = 1
    elif _counts.get("BAD_INPUT"):
        log.error("BAD_INPUT present: this script sent a malformed request; fix "
                  "before reporting the run")
        environment.process_exit_code = 2
    else:
        environment.process_exit_code = 0


# ── Attacker ─────────────────────────────────────────────────────────────────

class TenantAttacker(HttpUser):
    """A viewer of tenant A firing at tenant B through the frontend proxy."""

    host = FRONTEND_HOST
    wait_time = constant_throughput(THROUGHPUT_PER_USER)

    def on_start(self):
        # The proxy sets an httpOnly session cookie; the locust cookie jar keeps
        # it and every later request is authenticated as tenant A's viewer.
        r = self.client.post("/api/auth/login", name="auth:login",
                             json={"email": LOGIN_EMAIL, "password": LOGIN_PASSWORD})
        if r.status_code != 200:
            log.error("re-login failed for a user: HTTP %s", r.status_code)

    # -- helpers -------------------------------------------------------------

    def _read(self, path: str, name: str) -> None:
        with self.client.get(path, name=name, catch_response=True) as resp:
            outcome = classify(resp.status_code, resp.text, write=False)
            _record(outcome, name)
            if outcome in PASS:
                resp.success()
            else:
                resp.failure(f"{outcome} HTTP {resp.status_code}")

    def _post(self, path: str, name: str, payload: dict) -> None:
        with self.client.post(path, name=name, json=payload, catch_response=True) as resp:
            outcome = classify(resp.status_code, resp.text, write=False)
            _record(outcome, name)
            if outcome in PASS:
                resp.success()
            else:
                resp.failure(f"{outcome} HTTP {resp.status_code}")

    def _write(self, method: str, path: str, name: str, payload: dict | None = None) -> None:
        with self.client.request(method, path, name=name, json=payload,
                                 catch_response=True) as resp:
            outcome = classify(resp.status_code, resp.text, write=True)
            _record(outcome, name)
            if outcome in PASS:
                resp.success()
            else:
                resp.failure(f"{outcome} HTTP {resp.status_code}")

    def _raw(self, name: str, headers: dict | None) -> None:
        """A request with NO session cookie, for the API2 auth cases. Fired as a
        bare call and reported into locust's stats by hand."""
        url = f"{FRONTEND_HOST}/api/v1/projects/{TARGET.project_id}"
        t0 = time.perf_counter()
        exc = None
        status = 0
        length = 0
        try:
            r = requests.get(url, headers=headers or {}, timeout=15)
            status, length = r.status_code, len(r.content)
            outcome = classify(status, r.text, write=False)
        except Exception as e:  # noqa: BLE001
            outcome = "ERROR"
            exc = e
        _record(outcome, name)
        if outcome not in PASS and exc is None:
            exc = Exception(f"{outcome} HTTP {status}")
        self.environment.events.request.fire(
            request_type="AUTH", name=name,
            response_time=(time.perf_counter() - t0) * 1000,
            response_length=length, exception=exc, context={})

    # -- API1: Broken Object Level Authorization -----------------------------

    @task(6)
    def api1_project_subtree(self):
        p = TARGET.project_id
        for sub in ("", "/metric-points", "/latest-values", "/health", "/graph",
                    "/channels", "/dashboards", "/events?limit=50"):
            self._read(f"/api/v1/projects/{p}{sub}", f"API1 GET /projects/{{id}}{sub.split('?')[0]}")

    @task(3)
    def api1_metric_points(self):
        for mp in TARGET.metric_point_ids[:5]:
            self._read(f"/api/v1/metric-points/{mp}", "API1 GET /metric-points/{id}")

    @task(2)
    def api1_objects_and_sites(self):
        for oid in TARGET.asset_object_ids[:3]:
            self._read(f"/api/v1/objects/{oid}/metrics", "API1 GET /objects/{id}/metrics")
        for b in TARGET.building_ids[:2]:
            self._read(f"/api/v1/sites/{b}/objects", "API1 GET /sites/{id}/objects")
            self._read(f"/api/v1/sites/{b}/graph", "API1 GET /sites/{id}/graph")

    @task(2)
    def api1_tenant(self):
        self._read(f"/api/v1/tenants/{TARGET.tenant_id}", "API1 GET /tenants/{id}")
        self._read(f"/api/v1/tenants/{TARGET.tenant_id}/members", "API1 GET /tenants/{id}/members")

    @task(3)
    def api1_analytics(self):
        mp = TARGET.metric_point_ids
        window = {"start": 0, "end": 4102444800}
        channels = [{"device_id": d, "metric_id": 1, "ref": d} for d in TARGET.device_ids[:3]]
        self._post("/api/analytics/stats/latest", "API1 POST /stats/latest",
                   {"metric_point_ids": mp})
        self._post("/api/analytics/stats/timeseries", "API1 POST /stats/timeseries",
                   {"metric_point_ids": mp[:5], "time_range": window, "resample": "1h"})
        self._post("/api/analytics/stats/descriptive", "API1 POST /stats/descriptive",
                   {"metric_point_ids": mp[:5], "time_range": window})
        self._post("/api/analytics/stats/series", "API1 POST /stats/series",
                   {"channels": channels, "start": window["start"], "end": window["end"],
                    "resample": "1h", "aggregation": "mean"})
        self._post("/api/analytics/stats/latest-by-channel", "API1 POST /stats/latest-by-channel",
                   {"channels": channels})

    # -- API2: Broken Authentication -----------------------------------------

    @task(2)
    def api2_broken_auth(self):
        # No credentials at all.
        self._raw("API2 no-token", headers=None)
        # A syntactically broken bearer token.
        self._raw("API2 malformed-token", headers={"Authorization": "Bearer not-a-jwt"})
        # Valid-looking claims, signed with a key the platform does not hold.
        self._raw("API2 wrong-signature", headers={"Authorization": f"Bearer {_wrong_signature_token()}"})

    # -- API3: Broken Object Property Level Authorization ---------------------

    @task(2)
    def api3_collections_must_filter(self):
        # These answer 2xx by design; a tenant-B id in the body is the leak.
        for path, name in (
            ("/api/v1/projects", "API3 GET /projects (filtered?)"),
            ("/api/v1/tenants", "API3 GET /tenants (filtered?)"),
            (f"/api/v1/sites?tenantId={TARGET.tenant_id}&page=1&pageSize=100",
             "API3 GET /sites?tenantId= (filtered?)"),
            ("/api/v1/events?limit=50", "API3 GET /events (filtered?)"),
        ):
            self._read(path, name)

    # -- API5: Broken Function Level Authorization (opt-in, destructive) ------

    @task(1)
    def api5_privileged_and_writes(self):
        if not INCLUDE_WRITES:
            return
        # A viewer attempting writes on tenant B. Any 2xx here is a leak.
        for oid in TARGET.device_object_ids[:2]:
            self._write("DELETE", f"/api/v1/objects/{oid}", "API5 DELETE /objects/{id}")
        self._write("PATCH", f"/api/v1/projects/{TARGET.project_id}",
                    "API5 PATCH /projects/{id}", {"name": "pwned"})
        if len(TARGET.device_object_ids) >= 2:
            self._write("POST", "/api/v1/links", "API5 POST /links",
                        {"sourceId": TARGET.device_object_ids[0],
                         "targetId": TARGET.device_object_ids[1],
                         "linkTypeName": "CONTAINS"})
        for pid in TARGET.person_ids[:1]:
            self._write("DELETE", f"/api/v1/privacy/persons/{pid}",
                        "API5 DELETE /privacy/persons/{id}")
