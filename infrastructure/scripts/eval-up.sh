#!/usr/bin/env bash
# Bring the evaluation environment up to the point where load can be applied.
#
# Encodes the order and the waits that a measurement session depends on, so a
# session starts from a known-good platform instead of from a manual sequence.
#
#   ./eval-up.sh            cluster, platform, 100-device fleet
#   ./eval-up.sh --smoke    same, plus a 60 s telemetry burst that proves rows land
#
# Afterwards run the scenarios from evaluation/scripts/ingest-scenario.sh
# (ingest) and evaluation/load/locustfile.py (query APIs), both from OUTSIDE
# the cluster. Tear down with eval-down.sh.
set -euo pipefail

PROJECT=${PROJECT:-heating-platform-eval}
REGION=${REGION:-europe-west3}
CLUSTER=${CLUSTER:-heating-platform}
REGISTRY=${REGISTRY:-europe-west3-docker.pkg.dev/heating-platform-eval/heating-platform}
NS=heating-platform
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
SMOKE=${1:-}

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
note() { printf '    %s\n' "$*"; }

step "Cluster (terraform)"
terraform -chdir="$ROOT/infrastructure/terraform" apply -auto-approve -var project_id="$PROJECT"

step "kubeconfig"
# Without this kubectl keeps talking to the endpoint of a previous, destroyed
# cluster and every following step dies in a timeout.
gcloud container clusters get-credentials "$CLUSTER" --region "$REGION" --project "$PROJECT"

step "Deploy platform"
kubectl apply -k "$ROOT/infrastructure/kubernetes/overlays/gke"

step "Wait for pods (Autopilot provisions nodes first, this takes minutes)"
# Ready means READY=1/1. A pod can sit in Running while its process is stuck,
# which is exactly how the missing DB_PORT hid itself once.
deadline=$(( $(date +%s) + 900 ))
while :; do
  lines=$(kubectl -n $NS get pods --no-headers 2>/dev/null | grep -v Completed || true)
  total=$(printf '%s\n' "$lines" | grep -c . || true)
  # Ready means every container in the pod is ready (N/N), not just Running.
  ready=$(printf '%s\n' "$lines" | awk -F'[ /]+' '$2==$3' | grep -c . || true)
  [ "$total" -ge 10 ] && [ "$total" = "$ready" ] && break
  [ "$(date +%s)" -gt "$deadline" ] && { echo "pods did not converge in 15 min"; kubectl -n $NS get pods; exit 1; }
  note "$ready/$total ready"
  sleep 15
done
kubectl -n $NS get pods

step "Seed the fleet (100 devices)"
kubectl delete -f "$ROOT/infrastructure/kubernetes/jobs/mock-seed.yaml" --ignore-not-found >/dev/null
kubectl apply -f "$ROOT/infrastructure/kubernetes/jobs/mock-seed.yaml"
kubectl -n $NS wait --for=condition=complete job/mock-seed --timeout=300s
kubectl -n $NS logs job/mock-seed --tail=2

step "Wait for the device.configured sweep (<=30 s in device-management)"
sleep 40
# The ingestion pods follow the compacted topic live, so this is a check and
# not a restart: every accepted device must be in the projection before load.
# Captured first, then trimmed. Piping the producer straight into `head`
# closes the pipe early, and with `set -e` plus `pipefail` the resulting
# SIGPIPE (exit 141) aborts the whole bring-up.
topic_info=$(kubectl -n $NS exec kafka-0 -- /opt/kafka/bin/kafka-topics.sh \
  --bootstrap-server localhost:9092 --describe --topic device.configured 2>/dev/null || true)
printf '%s\n' "$topic_info" | sed -n '1,2p'

if [ "$SMOKE" = "--smoke" ]; then
  step "Smoke: 60 s of telemetry, then count what landed"
  before=$(kubectl -n $NS exec measurement-db-0 -- psql -U postgres -d digital_demon_measurements -tAc "select count(*) from measurements;")
  smoke_log=$(kubectl -n $NS run mock-smoke --rm -i --restart=Never --image="$REGISTRY/mock-service:latest" -- \
    run --sites=25 --rooms=3 --interval=2 --duration=60 --broker=mosquitto:1883 --connections=4 2>&1 || true)
  printf '%s\n' "$smoke_log" | tail -3
  after=$(kubectl -n $NS exec measurement-db-0 -- psql -U postgres -d digital_demon_measurements -tAc "select count(*) from measurements;")
  note "new rows: $((after - before))  (expect roughly 60 s x 125 measurements/s at interval 2)"
  kubectl -n $NS exec measurement-db-0 -- psql -U postgres -d digital_demon_measurements -tAc \
    "select 'p95_ms=' || round((percentile_cont(0.95) within group (order by extract(epoch from persisted_at - received_at)*1000))::numeric,1) from measurements where received_at > now() - interval '3 minutes';"
fi

step "Internal entry points for the load generators"
# The generators run outside the cluster but inside the project, as Cloud Run
# jobs with direct VPC egress. That keeps them from competing with the services
# under test for pod resources, needs no public endpoint at all, and takes the
# operator's uplink out of the measurement.
kubectl apply -f "$ROOT/infrastructure/kubernetes/eval/internal-access.yaml"
until [ -n "$(kubectl -n $NS get svc mosquitto-internal -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null)" ]; do
  note "waiting for the internal LoadBalancer"
  sleep 15
done
BROKER=$(kubectl -n $NS get svc mosquitto-internal -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
note "mosquitto reachable inside the VPC at $BROKER"

step "Cloud Run generator job"
gcloud run jobs deploy mock-load \
  --image="$REGISTRY/mock-service:latest" \
  --region="$REGION" --project="$PROJECT" \
  --network="$CLUSTER-vpc" --subnet="$CLUSTER-subnet" --vpc-egress=private-ranges-only \
  --task-timeout=3600 --max-retries=0 --cpu=2 --memory=2Gi \
  --args="run,--sites=25,--rooms=3,--interval=2,--duration=60,--broker=$BROKER:1883,--connections=8" \
  --quiet
# The args above are only the default; ingest-scenario.sh overrides them per
# execution, so one job serves every scenario.

step "Ready"
kubectl -n $NS get hpa,pods
cat <<NEXT

Next:

  1. Capacity first. Twelve minutes, and it tells you whether the 2500
     measurements/s of QS-PER-02 are inside the store's ceiling at all:
       evaluation/scripts/ingest-scenario.sh ramp

  2. The ingest scenarios:
       evaluation/scripts/ingest-scenario.sh qs-per-01
       evaluation/scripts/ingest-scenario.sh qs-per-02

  3. Query APIs (QS-PER-03), while an ingest base load runs. locust still runs
     from this machine, so it needs the public entry points; apply
     eval/external-access.yaml for that step only, and mind that curl -4 is
     required when reading your own IP (a dual-stack link answers with IPv6):
       MY_IP=\$(curl -4 -s ifconfig.me)
       sed "s|MEINE_IP|\$MY_IP|" infrastructure/kubernetes/eval/external-access.yaml | kubectl apply -f -

  4. Tear down (removes both entry-point sets, then the cluster):
       infrastructure/scripts/eval-down.sh
NEXT
