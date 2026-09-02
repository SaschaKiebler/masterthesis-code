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
# Fleet arithmetic (must match infrastructure/kubernetes/jobs/mock-seed.yaml,
# prefix included, since the tenant id is derived from it):
#   prefix tenanta, 25 sites x (1 boiler + 3 room sensors) = 100 devices
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
  local args="run,--prefix=tenanta,--sites=25,--rooms=3,--interval=$iv,--duration=$dur,--broker=$BROKER:1883,--connections=8"
  if [ "$GEN" = cloudrun ]; then
    local wait_flag=--wait
    [ -n "$async" ] && wait_flag=--async
    # Never swallow the error here. A run whose spike silently failed to start
    # looks like a completed measurement and is worse than no measurement: it
    # was a local network outage that once cost a full 15-minute run, and the
    # report still came out looking plausible. Retry, then give up loudly.
    local attempt out err
    err=$(mktemp)
    for attempt in 1 2 3; do
      # stderr must go to a FILE, not into `out`: gcloud writes progress there,
      # and folding it into stdout once produced an execution name that no
      # describe call could resolve, so the wait loop below span all night.
      if out=$(gcloud run jobs execute "$JOB" --region="$REGION" --project="$PROJECT" \
                 --args="$args" "$wait_flag" --format="value(name)" 2>"$err"); then
        rm -f "$err"
        printf '%s' "$(printf '%s' "$out" | tr -d '[:space:]')"
        return 0
      fi
      echo "run_load: attempt $attempt failed: $(cat "$err")" >&2
      sleep 20
    done
    rm -f "$err"
    echo "run_load: could not start the generator after 3 attempts, aborting" >&2
    return 1
  else
    local flags="--prefix=tenanta --sites=25 --rooms=3 --broker=$BROKER:1883 --interval=$iv --duration=$dur --connections=8"
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

# Scaling is a response measure of its own (AT-12), and a snapshot taken after
# the run misses the peak because the autoscaler has already scaled back down.
# Sample it as a time series for as long as the load runs.
scaling_csv=$OUT/$SCENARIO-$STAMP-scaling.csv
echo "time_utc,replicas,ready_pods,hpa_cpu_pct,db_cpu_millicores,ingest_cpu_millicores" > "$scaling_csv"
sample_scaling() {
  while :; do
    printf '%s,%s,%s,%s,%s,%s\n' \
      "$(date -u +%H:%M:%S)" \
      "$(kubectl -n $NS get hpa ingestion-service -o jsonpath='{.status.currentReplicas}' 2>/dev/null)" \
      "$(kubectl -n $NS get pods -l app=ingestion-service --no-headers 2>/dev/null | grep -c '1/1')" \
      "$(kubectl -n $NS get hpa ingestion-service -o jsonpath='{.status.currentMetrics[0].resource.current.averageUtilization}' 2>/dev/null)" \
      "$(kubectl top pod measurement-db-0 -n $NS --no-headers 2>/dev/null | awk '{gsub(/m/,"",$2); print $2}')" \
      "$(kubectl top pods -n $NS -l app=ingestion-service --no-headers 2>/dev/null | awk '{gsub(/m/,"",$2); s+=$2} END {print s}')" \
      >> "$scaling_csv"
    sleep 15
  done
}
sample_scaling & sampler_pid=$!
trap 'kill $sampler_pid 2>/dev/null' EXIT

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
    if ! e=$(run_load 0.125 300); then
      echo "FAILED: the spike never started, so this run carries no spike." >&2
      echo "Discard it and repeat the scenario." >&2
      kill $sampler_pid 2>/dev/null
      exit 1
    fi
    generator_stats "$e"
    step "spike over, base load continues (recovery window)"
    if [ "$GEN" = cloudrun ]; then
      # Bounded, and loud when it gives up. An unbounded version of this loop
      # kept a cluster alive overnight after the execution name it polled for
      # turned out to be unresolvable.
      deadline=$(( $(date +%s) + dur + 600 ))
      until [ -n "$(gcloud run jobs executions describe "$base" --region="$REGION" --project="$PROJECT" --format='value(status.completionTime)' 2>/dev/null)" ]; do
        if [ "$(date +%s)" -gt "$deadline" ]; then
          echo "base load execution '$base' did not report completion in time, aborting" >&2
          kill $sampler_pid 2>/dev/null
          exit 1
        fi
        sleep 20
      done
    else
      wait "$base"
    fi
    generator_stats "$base"
    ;;
  *) echo "unknown scenario: $SCENARIO"; exit 1 ;;
esac
end=$(utc)
kill $sampler_pid 2>/dev/null; trap - EXIT

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
  echo
  echo "######## scaling over time ########"
  echo "peak replicas: $(awk -F, 'NR>1 && $2>m {m=$2} END {print m+0}' "$scaling_csv")"
  echo "full series in $(basename "$scaling_csv")"
  echo
  echo "######## autoscaler decisions ########"
  # Why it scaled and when; these events expire after about an hour, so they
  # only survive if they are captured here.
  kubectl -n $NS describe hpa ingestion-service | sed -n '/Events:/,$p'
} | tee "$report"

step "Written to $report"
echo "Loss rate: compare 'persisted measurements' above against the generator's"
echo "own 'measurements=' counter printed per step (see loss-rate.sql header)."
