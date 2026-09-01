#!/usr/bin/env bash
# Run one ingest load scenario from OUTSIDE the cluster and evaluate it.
#
# The generator runs here on purpose: real load originates outside, and an
# in-cluster generator would compete with the services under test for pod
# resources (same reasoning as evaluation/load/locustfile.py).
#
#   ./ingest-scenario.sh ramp      <mosquitto-ip>   4 x 3 min at 500/1000/2000/2500 msmt/s
#   ./ingest-scenario.sh qs-per-01 <mosquitto-ip>   500 msmt/s for 30 min
#   ./ingest-scenario.sh qs-per-02 <mosquitto-ip>   base load + 5 min spike to 2500 msmt/s
#
# Fleet arithmetic (must match infrastructure/kubernetes/jobs/mock-seed.yaml):
#   25 sites x (1 boiler + 3 room sensors) = 100 devices
#   per publish interval: 175 messages carrying 250 measurements
#   => measurements/s = 250 / interval
# Run `ramp` first: it costs minutes and tells you whether the 2500/s of
# QS-PER-02 is inside the measurement store's ceiling at all.
set -uo pipefail

SCENARIO=${1:?usage: ingest-scenario.sh <ramp|qs-per-01|qs-per-02> <broker-ip> [duration_s]}
BROKER=${2:?usage: ingest-scenario.sh <ramp|qs-per-01|qs-per-02> <broker-ip> [duration_s]}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
MOCK=$ROOT/applications/mock-service/.venv/bin/mock-service
NS=heating-platform
FLEET="--sites=25 --rooms=3 --broker=$BROKER:1883"
STAMP=$(date +%Y%m%d-%H%M%S)
OUT=$ROOT/evaluation/results

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
utc()  { date -u +"%Y-%m-%d %H:%M:%S+00"; }

[ -x "$MOCK" ] || { echo "mock-service venv missing at $MOCK"; exit 1; }

start=$(utc)
case "$SCENARIO" in
  ramp)
    for iv in 0.5 0.25 0.125 0.1; do
      rate=$(python3 -c "print(round(250/$iv))")
      step "ramp step: $rate measurements/s for 180 s (interval $iv)"
      "$MOCK" run $FLEET --interval="$iv" --duration=180 --connections=8 2>&1 | tail -2
    done
    ;;
  qs-per-01)
    dur=${3:-1800}
    step "QS-PER-01: 500 measurements/s for ${dur} s"
    "$MOCK" run $FLEET --interval=0.5 --duration="$dur" --connections=8 2>&1 | tail -3
    ;;
  qs-per-02)
    dur=${3:-900}
    step "QS-PER-02: base load ${dur} s, spike to 2500 measurements/s after 300 s"
    "$MOCK" run $FLEET --interval=0.5 --duration="$dur" --connections=8 > "$OUT/$SCENARIO-$STAMP-base.log" 2>&1 &
    base=$!
    sleep 300
    step "spike: +2000 measurements/s for 300 s"
    # A second generator on the same fleet: the devices simply report more
    # often, which is the spike the scenario describes.
    "$MOCK" run $FLEET --interval=0.125 --duration=300 --connections=8 2>&1 | tail -2
    step "spike over, base load continues (recovery window)"
    wait $base
    tail -2 "$OUT/$SCENARIO-$STAMP-base.log"
    ;;
  *) echo "unknown scenario: $SCENARIO"; exit 1 ;;
esac
end=$(utc)

step "Window: $start .. $end"
report=$OUT/$SCENARIO-$STAMP.txt
{
  echo "scenario : $SCENARIO"
  echo "window   : $start .. $end"
  echo
  for sql in loss-rate latency-percentiles; do
    echo "######## $sql ########"
    kubectl -n $NS exec -i measurement-db-0 -- psql -U postgres -d digital_demon_measurements \
      -v start="'$start'" -v end="'$end'" -f - < "$ROOT/evaluation/sql/$sql.sql"
    echo
  done
  echo "######## ingestion pods ########"
  kubectl -n $NS get hpa ingestion-service
  kubectl -n $NS get pods -l app=ingestion-service
} | tee "$report"

step "Written to $report"
echo "Compare the persisted measurements above against the generator's own"
echo "'measurements=' counter to get the loss rate (see the header of loss-rate.sql)."
