#!/usr/bin/env bash
# Run one ingest load scenario and evaluate it against the measurement store.
#
# The generator runs OUTSIDE the cluster, as a Cloud Run job with direct VPC
# egress that reaches mosquitto through the internal LoadBalancer from
# infrastructure/kubernetes/eval/internal-access.yaml. That keeps the
# methodological point (the generator does not compete with the services under
# test for pod resources) without exposing anything publicly, and it takes the
# operator's uplink out of the measurement: QS-PER-02 asks for ~1750 msg/s,
# which a laptop behind a campus NAT may not be able to produce at all.
# Set GEN=local to drive it from this machine instead (needs the external
# LoadBalancers and a broker IP that your network can actually reach).
#
#   ./ingest-scenario.sh ramp                    4 x 3 min at 500/1000/2000/2500 msmt/s
#   ./ingest-scenario.sh qs-per-01 [duration_s]  500 msmt/s, default 30 min
#   ./ingest-scenario.sh qs-per-02 [duration_s]  base load + 5 min spike to 2500
#
# Fleet arithmetic (must match infrastructure/kubernetes/jobs/mock-seed.yaml):
#   25 sites x (1 boiler + 3 room sensors) = 100 devices
#   per publish interval: 175 messages carrying 250 measurements
#   => measurements/s = 250 / interval
# Run `ramp` first: it costs twelve minutes and tells you whether the 2500/s of
# QS-PER-02 is inside the measurement store's ceiling at all.
set -uo pipefail

SCENARIO=${1:?usage: ingest-scenario.sh <ramp|qs-per-01|qs-per-02> [duration_s]}
PROJECT=${PROJECT:-heating-platform-eval}
REGION=${REGION:-europe-west3}
JOB=${JOB:-mock-load}
GEN=${GEN:-cloudrun}
NS=heating-platform
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
MOCK=$ROOT/applications/mock-service/.venv/bin/mock-service
STAMP=$(date +%Y%m%d-%H%M%S)
OUT=$ROOT/evaluation/results
mkdir -p "$OUT"

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
utc()  { date -u +"%Y-%m-%d %H:%M:%S+00"; }

if [ "$GEN" = cloudrun ]; then
  BROKER=${BROKER:-$(kubectl -n $NS get svc mosquitto-internal -o jsonpath='{.status.loadBalancer.ingress[0].ip}')}
else
  BROKER=${BROKER:?set BROKER=<reachable mosquitto ip> for GEN=local}
fi
[ -n "$BROKER" ] || { echo "no broker address (is internal-access.yaml applied?)"; exit 1; }
echo "generator=$GEN broker=$BROKER"

# run_load <interval> <duration> [async]
# Prints the execution id on async, so the caller can collect its log later.
run_load() {
  local iv=$1 dur=$2 async=${3:-}
  local args="run,--sites=25,--rooms=3,--interval=$iv,--duration=$dur,--broker=$BROKER:1883,--connections=8"
  if [ "$GEN" = cloudrun ]; then
    if [ -n "$async" ]; then
      gcloud run jobs execute "$JOB" --region="$REGION" --project="$PROJECT" \
        --args="$args" --async --format="value(name)" 2>/dev/null
    else
      gcloud run jobs execute "$JOB" --region="$REGION" --project="$PROJECT" \
        --args="$args" --wait --format="value(name)" 2>/dev/null
    fi
  else
    local flags="--sites=25 --rooms=3 --broker=$BROKER:1883 --interval=$iv --duration=$dur --connections=8"
    if [ -n "$async" ]; then "$MOCK" run $flags >"$OUT/$SCENARIO-$STAMP-async.log" 2>&1 & echo $!
    else "$MOCK" run $flags 2>&1 | tail -2; fi
  fi
}

# What the generator itself counted; the loss rate needs this, not just the DB.
generator_stats() {
  local exec=$1
  [ "$GEN" = cloudrun ] || { tail -2 "$OUT/$SCENARIO-$STAMP-async.log" 2>/dev/null; return; }
  gcloud logging read \
    "resource.type=cloud_run_job AND labels.\"run.googleapis.com/execution_name\"=\"$exec\" AND textPayload:\"run finished\"" \
    --project="$PROJECT" --limit=1 --format="value(textPayload)" 2>/dev/null
}

start=$(utc)
case "$SCENARIO" in
  ramp)
    for iv in 0.5 0.25 0.125 0.1; do
      rate=$(python3 -c "print(round(250/$iv))")
      step "ramp step: $rate measurements/s for 180 s (interval $iv)"
      e=$(run_load "$iv" 180)
      generator_stats "$e"
    done
    ;;
  qs-per-01)
    dur=${2:-1800}
    step "QS-PER-01: 500 measurements/s for ${dur} s"
    e=$(run_load 0.5 "$dur")
    generator_stats "$e"
    ;;
  qs-per-02)
    dur=${2:-900}
    step "QS-PER-02: base load ${dur} s, spike to 2500 measurements/s after 300 s"
    base=$(run_load 0.5 "$dur" async)
    sleep 300
    step "spike: +2000 measurements/s for 300 s"
    # A second generator on the same fleet: the devices simply report more
    # often, which is the spike the scenario describes.
    e=$(run_load 0.125 300)
    generator_stats "$e"
    step "spike over, base load continues (recovery window)"
    if [ "$GEN" = cloudrun ]; then
      until [ "$(gcloud run jobs executions describe "$base" --region="$REGION" --project="$PROJECT" --format='value(status.completionTime)' 2>/dev/null)" != "" ]; do sleep 20; done
    else
      wait "$base"
    fi
    generator_stats "$base"
    ;;
  *) echo "unknown scenario: $SCENARIO"; exit 1 ;;
esac
end=$(utc)

step "Window: $start .. $end"
report=$OUT/$SCENARIO-$STAMP.txt
{
  echo "scenario  : $SCENARIO"
  echo "generator : $GEN (broker $BROKER)"
  echo "window    : $start .. $end"
  echo
  for sql in loss-rate latency-percentiles; do
    echo "######## $sql ########"
    kubectl -n $NS exec -i measurement-db-0 -- psql -U postgres -d digital_demon_measurements \
      -v start="'$start'" -v end="'$end'" -f - < "$ROOT/evaluation/sql/$sql.sql"
    echo
  done
  echo "######## ingestion ########"
  kubectl -n $NS get hpa ingestion-service
  kubectl -n $NS get pods -l app=ingestion-service
} | tee "$report"

step "Written to $report"
echo "Loss rate: compare 'persisted measurements' above against the generator's"
echo "own 'measurements=' counter printed per step (see loss-rate.sql header)."
