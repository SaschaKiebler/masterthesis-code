#!/usr/bin/env bash
# QS-SEC-01: cross-tenant attacks under load, through the frontend proxy.
#
# The generator runs as a Cloud Run job with direct VPC egress, like the ingest
# and query generators, so it sits outside the cluster without anything being
# exposed publicly and without the operator's uplink entering the measurement.
#
# Two properties of this run are what make it QS-SEC-01 rather than a repeat of
# the earlier local probe:
#   - it logs in as the TENANT-BOUND probe user, never the bootstrap admin, who
#     would short-circuit the tenant check on its first line;
#   - it talks only to the frontend proxy, the platform's single external
#     surface, so no backend service is addressed directly.
#
#   ./security-scenario.sh [run_time]     run_time as locust accepts it, default 10m
#
# Measured, per thesis ch. 6:
#   - leaks: responses carrying tenant B identifiers  (target 0)
#   - exposed surface: API9 probes that answered 2xx, reported apart from leaks
#   - audit coverage: access_audit rows for the window (target: one per attempt
#     that named a tenant; see evaluation/sql/audit-coverage.sql)
#   - the attack traffic IS the scenario's 50 requests/s base load
#
# INCLUDE_WRITES=true adds destructive API5 attempts against tenant B. Off by
# default; reseed tenant B afterwards when you use it.
set -uo pipefail

RUN_TIME=${1:-10m}
USERS=${USERS:-25}          # 25 users x 2 req/s = 50 req/s, the required base load
SPAWN=${SPAWN:-5}
PROJECT=${PROJECT:-heating-platform-eval}
REGION=${REGION:-europe-west3}
REGISTRY=${REGISTRY:-europe-west3-docker.pkg.dev/heating-platform-eval/heating-platform}
NS=heating-platform
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
STAMP=$(date +%Y%m%d-%H%M%S)
OUT=$ROOT/evaluation/results
mkdir -p "$OUT"

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
utc()  { date -u +"%Y-%m-%d %H:%M:%S+00"; }

ip_of() { kubectl -n $NS get svc "$1" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null; }
FRONTEND=$(ip_of frontend-internal)
if [ -z "$FRONTEND" ]; then
  echo "no internal IP for frontend-internal."
  echo "Apply the eval entry points first:"
  echo "  kubectl apply -f infrastructure/kubernetes/eval/internal-access.yaml"
  echo "  kubectl -n $NS get svc frontend-internal -w"
  exit 1
fi
FRONTEND_HOST=http://$FRONTEND:3000
echo "frontend proxy (the only surface used): $FRONTEND_HOST"

# The login decides what is actually measured. A system admin bypasses the
# tenant check entirely, so the locustfile refuses to start under admin@local.
LOGIN_EMAIL=${LOGIN_EMAIL:-probe-tenanta@example.org}
LOGIN_PASSWORD=${LOGIN_PASSWORD:-probe-pw-2026}
TARGET_PREFIX=${TARGET_PREFIX:-tenantb}
TARGET_SITES=${TARGET_SITES:-2}
TARGET_ROOMS=${TARGET_ROOMS:-2}
TARGET_PERSONS=${TARGET_PERSONS:-0}
INCLUDE_WRITES=${INCLUDE_WRITES:-false}
if [ "$LOGIN_EMAIL" = "admin@local" ]; then
  echo "admin@local bypasses tenant enforcement; QS-SEC-01 needs a tenant user." >&2
  exit 1
fi
echo "attacker: $LOGIN_EMAIL   target tenant: $TARGET_PREFIX   writes: $INCLUDE_WRITES"

step "Deploy the security load job"
gcloud run jobs deploy locust-load \
  --image="$REGISTRY/locust-load:latest" \
  --region="$REGION" --project="$PROJECT" \
  --network=heating-platform-vpc --subnet=heating-platform-subnet --vpc-egress=private-ranges-only \
  --task-timeout=3600 --max-retries=0 --cpu=2 --memory=2Gi \
  --set-env-vars="LOCUST_FILE=security_locustfile.py,FRONTEND_HOST=$FRONTEND_HOST,LOGIN_EMAIL=$LOGIN_EMAIL,LOGIN_PASSWORD=$LOGIN_PASSWORD,TARGET_PREFIX=$TARGET_PREFIX,TARGET_SITES=$TARGET_SITES,TARGET_ROOMS=$TARGET_ROOMS,TARGET_PERSONS=$TARGET_PERSONS,INCLUDE_WRITES=$INCLUDE_WRITES" \
  --args="-u,$USERS,-r,$SPAWN,--run-time,$RUN_TIME" \
  --quiet >/dev/null || { echo "deploy of locust-load failed"; exit 1; }

start=$(utc)
step "Run: $USERS users, spawn $SPAWN/s, $RUN_TIME, i.e. ~$((USERS * 2)) req/s of attacks"
err=$(mktemp)
exec_failed=0
exec_name=$(gcloud run jobs execute locust-load --region="$REGION" --project="$PROJECT" \
  --wait --format="value(name)" 2>"$err") || exec_failed=1
if [ -z "$exec_name" ]; then
  exec_name=$(grep -o 'locust-load-[a-z0-9]*' "$err" | head -1)
fi
# A non-zero exit is EXPECTED to be meaningful here: the locustfile sets exit
# code 1 when it found a leak and 2 when it sent a malformed request. Do not
# treat it as "no result", the result is exactly what we came for.
[ "$exec_failed" = "1" ] && echo "NOTE: execution marked failed (leak or bad input, see the report): $(tail -2 "$err")" >&2
rm -f "$err"
[ -n "$exec_name" ] || { echo "no execution name, nothing to collect" >&2; exit 1; }
exec_name=$(printf '%s' "$exec_name" | tr -d '[:space:]')
end=$(utc)
echo "    execution $exec_name"

step "Collect the locust results out of Cloud Logging"
logs=$(mktemp)
gcloud logging read \
  "resource.type=cloud_run_job AND labels.\"run.googleapis.com/execution_name\"=\"$exec_name\"" \
  --project="$PROJECT" --limit=4000 --order=desc --format="value(textPayload)" 2>/dev/null \
  | tail -r > "$logs"

for part in stats failures stats_history; do
  csv=$OUT/qs-sec-01-$STAMP-$part.csv
  awk -v b="===== CSV BEGIN ${part} =====" -v e="===== CSV END ${part} =====" \
    '$0==b {inside=1; next} $0==e {inside=0} inside' "$logs" > "$csv"
  if [ -s "$csv" ]; then echo "    $(basename "$csv") ($(wc -l < "$csv" | tr -d ' ') Zeilen)"; else rm -f "$csv"; fi
done
if [ ! -s "$OUT/qs-sec-01-$STAMP-stats.csv" ]; then
  echo "no locust statistics in the logs, this run produced no result" >&2
  exit 1
fi

report=$OUT/qs-sec-01-$STAMP.txt
{
  echo "scenario  : qs-sec-01"
  echo "window    : $start .. $end"
  echo "surface   : $FRONTEND_HOST (frontend proxy only, no backend service addressed)"
  echo "attacker  : $LOGIN_EMAIL (tenant-bound, NOT the bootstrap admin)"
  echo "target    : tenant '$TARGET_PREFIX', $TARGET_SITES sites x $TARGET_ROOMS rooms"
  echo "load      : $USERS users x 2 req/s = $((USERS * 2)) req/s for $RUN_TIME"
  echo "writes    : $INCLUDE_WRITES"
  echo
  echo "######## outcome summary (from the generator) ########"
  grep -E "QS-SEC-01 outcomes|LEAKS \(|EXPOSED \(|BAD_INPUT present|logged in via the proxy" "$logs" | tail -8
  echo
  echo "######## per attack pattern (OWASP API Top 10 tagged) ########"
  # Name, request count and failure count per pattern: the coverage map.
  awk -F',' 'NR==1 || $2 ~ /^"?(API|auth)/ {printf "%-46s %8s %8s\n", $2, $3, $4}' \
    "$OUT/qs-sec-01-$STAMP-stats.csv" | head -50
  echo
  echo "######## failures ########"
  echo "A row is one of three things, and the summary above says which:"
  echo "  LEAK    a response carried a tenant-$TARGET_PREFIX identifier (the response measure)"
  echo "  EXPOSED an API9 surface answered 2xx (attack surface, not a data leak)"
  echo "  BAD_INPUT this script sent a malformed request (fix before reporting)"
  echo
  if [ -s "$OUT/qs-sec-01-$STAMP-failures.csv" ]; then
    cat "$OUT/qs-sec-01-$STAMP-failures.csv"
  else
    echo "none"
  fi
  echo
  echo "######## audit coverage ########"
  kubectl -n $NS exec -i stammdaten-db-0 -- psql -U postgres -d digital_demon \
    -v start="'$start'" -v end="'$end'" -f - < "$ROOT/evaluation/sql/audit-coverage.sql"
} | tee "$report"
rm -f "$logs"

step "Written to $report"
echo "Raw locust CSVs sit next to it as qs-sec-01-$STAMP-*.csv."
if [ "$INCLUDE_WRITES" = "true" ]; then
  echo "Writes were enabled: reseed tenant B before the next run."
  echo "  kubectl delete -f infrastructure/kubernetes/jobs/mock-seed-tenantb.yaml --ignore-not-found"
  echo "  kubectl apply  -f infrastructure/kubernetes/jobs/mock-seed-tenantb.yaml"
fi
