#!/usr/bin/env bash
# QS-PER-03: query APIs under parallel access, while an ingest base load runs.
#
# Both generators run as Cloud Run jobs with direct VPC egress. They are
# therefore outside the cluster, as the load profile requires, without making
# the operator's machine or uplink part of the measurement and without exposing
# anything publicly. See evaluation/README.md for the full setup.
#
#   ./query-scenario.sh [run_time]      run_time as locust accepts it, default 10m
#
# Measured, per thesis chapter 6:
#   - p95 response time and error rate of the query APIs (locust)
#   - loss rate of the ingest that runs alongside (SQL against the store)
set -uo pipefail

RUN_TIME=${1:-10m}
USERS=${USERS:-50}
SPAWN=${SPAWN:-10}
PROJECT=${PROJECT:-heating-platform-eval}
REGION=${REGION:-europe-west3}
REGISTRY=${REGISTRY:-europe-west3-docker.pkg.dev/heating-platform-eval/heating-platform}
NS=heating-platform
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
STAMP=$(date +%Y%m%d-%H%M%S)
# One folder per scenario, each with its own README explaining the run.
OUT=$ROOT/evaluation/results/qs-per-03
mkdir -p "$OUT"

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
utc()  { date -u +"%Y-%m-%d %H:%M:%S+00"; }

ip_of() { kubectl -n $NS get svc "$1" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null; }
CORE=$(ip_of core-platform-internal)
ANALYTICS=$(ip_of analytics-internal)
BROKER=$(ip_of mosquitto-internal)
for v in CORE ANALYTICS BROKER; do
  [ -n "${!v}" ] || { echo "no internal IP for $v. Apply eval/internal-access.yaml first."; exit 1; }
done
echo "core=$CORE analytics=$ANALYTICS broker=$BROKER"

# The login decides what is actually measured. A system admin short-circuits the
# tenant check on the first line, so a run as the bootstrap admin would report
# the cost of tenant enforcement as zero. Override with a tenant-bound probe
# user via LOGIN_EMAIL / LOGIN_PASSWORD.
LOGIN_EMAIL=${LOGIN_EMAIL:-probe-tenanta@example.org}
LOGIN_PASSWORD=${LOGIN_PASSWORD:-probe-pw-2026}
[ "$LOGIN_EMAIL" = "admin@local" ] && \
  echo "NOTE: running as the bootstrap admin, tenant enforcement is not exercised."

step "Ingest base load alongside (500 measurements/s)"
# Long enough to cover locust plus its harvest phase and teardown.
base=$(gcloud run jobs execute mock-load --region="$REGION" --project="$PROJECT" \
  --args="run,--prefix=tenanta,--sites=25,--rooms=3,--interval=0.5,--duration=1200,--broker=$BROKER:1883,--connections=8" \
  --async --format="value(name)" 2>/dev/null | tr -d '[:space:]')
[ -n "$base" ] || { echo "could not start the ingest base load, aborting"; exit 1; }
echo "    execution $base"

step "Deploy the locust job"
gcloud run jobs deploy locust-load \
  --image="$REGISTRY/locust-load:latest" \
  --region="$REGION" --project="$PROJECT" \
  --network=heating-platform-vpc --subnet=heating-platform-subnet --vpc-egress=private-ranges-only \
  --task-timeout=3600 --max-retries=0 --cpu=2 --memory=2Gi \
  --set-env-vars="CORE_HOST=http://$CORE:8080,ANALYTICS_HOST=http://$ANALYTICS:8100,LOGIN_EMAIL=$LOGIN_EMAIL,LOGIN_PASSWORD=$LOGIN_PASSWORD" \
  --args="-u,$USERS,-r,$SPAWN,--run-time,$RUN_TIME" \
  --quiet >/dev/null || { echo "deploy of locust-load failed"; exit 1; }

start=$(utc)
step "Run locust: $USERS users, spawn $SPAWN/s, $RUN_TIME"
err=$(mktemp)
# A non-zero exit here does not necessarily mean there is nothing to collect:
# the task may have run to completion and still be marked failed. Remember it
# and decide after looking for results.
exec_failed=0
exec_name=$(gcloud run jobs execute locust-load --region="$REGION" --project="$PROJECT" \
  --wait --format="value(name)" 2>"$err") || exec_failed=1
if [ -z "$exec_name" ]; then
  exec_name=$(grep -o 'locust-load-[a-z0-9]*' "$err" | head -1)
fi
[ "$exec_failed" = "1" ] && echo "NOTE: the execution is marked failed: $(tail -2 "$err")" >&2
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
# desc plus reverse, not asc: the CSVs are dumped at the END of the run, and an
# ascending fetch with a limit truncates exactly the part that matters.

for part in stats failures stats_history; do
  csv=$OUT/qs-per-03-$STAMP-$part.csv
  awk -v b="===== CSV BEGIN ${part} =====" -v e="===== CSV END ${part} =====" \
    '$0==b {inside=1; next} $0==e {inside=0} inside' "$logs" > "$csv"
  if [ -s "$csv" ]; then echo "    $(basename "$csv") ($(wc -l < "$csv" | tr -d ' ') Zeilen)"; else rm -f "$csv"; fi
done
if [ ! -s "$OUT/qs-per-03-$STAMP-stats.csv" ]; then
  echo "no locust statistics in the logs, this run produced no result" >&2
  exit 1
fi

report=$OUT/qs-per-03-$STAMP.txt
{
  echo "scenario  : qs-per-03"
  echo "window    : $start .. $end"
  echo "users     : $USERS, spawn $SPAWN/s, run time $RUN_TIME"
  echo "login     : $LOGIN_EMAIL"
  echo "endpoints : core http://$CORE:8080, analytics http://$ANALYTICS:8100"
  echo
  echo "######## locust summary ########"
  # The final table locust prints, plus the harvest and baseline lines.
  grep -E "baseline RTT|Type +Name|^GET |^POST |^ +Aggregated|Response time percentiles|^ +\"" "$logs" | tail -40
  echo
  echo "######## ingest alongside ########"
  for sql in loss-rate latency-percentiles; do
    echo "-------- $sql --------"
    kubectl -n $NS exec -i measurement-db-0 -- psql -U postgres -d heating_platform_measurements \
      -v start="'$start'" -v end="'$end'" -f - < "$ROOT/evaluation/sql/$sql.sql"
  done
} | tee "$report"
rm -f "$logs"

step "Written to $report"
echo "Raw locust CSVs sit next to it as qs-per-03-$STAMP-*.csv."
echo "The ingest base load keeps running until its own duration expires."
