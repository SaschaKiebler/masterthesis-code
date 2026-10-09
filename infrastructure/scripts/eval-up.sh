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

step "Stores first, stateless services after"
# Autopilot adds a node per pod it cannot place, and every node brings a 100 GB
# boot disk that counts against the regional SSD_TOTAL_GB quota. Rolling
# everything out at once therefore starts a race: if the nodes win it, the
# quota is gone and the PVCs never provision, which leaves the stores Pending
# and every service crash-looping against a database that will never come up.
# Holding the stateless services back keeps the node count low while the disks
# are created, so the race cannot be lost.
kubectl -n $NS scale deploy --all --replicas=0
deadline=$(( $(date +%s) + 600 ))
until [ "$(kubectl -n $NS get pvc --no-headers 2>/dev/null | grep -c Bound)" = "3" ]; do
  if [ "$(date +%s)" -gt "$deadline" ]; then
    echo "volumes did not bind in 10 min. Check the regional SSD_TOTAL_GB quota:"
    echo "  gcloud compute regions describe $REGION --project $PROJECT --format='value(quotas)' | tr ';' '\n' | grep SSD"
    kubectl -n $NS get pvc
    exit 1
  fi
  note "waiting for the volumes"
  sleep 15
done
note "volumes bound, bringing the services back"
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

step "Seed the second, small tenant"
# Only for the tenant fixtures, see the manifest. Not part of any load scenario.
kubectl delete -f "$ROOT/infrastructure/kubernetes/jobs/mock-seed-tenantb.yaml" --ignore-not-found >/dev/null
kubectl apply -f "$ROOT/infrastructure/kubernetes/jobs/mock-seed-tenantb.yaml"
kubectl -n $NS wait --for=condition=complete job/mock-seed-tenantb --timeout=300s

step "Create the tenant-bound probe users"
# QS-PER-03 must log in as a tenant user. A system admin short-circuits the
# tenant check on its first line, so a run as the bootstrap admin would report
# the cost of enforcement as zero. The probe creates the users through the
# public invitation flow. It runs on this machine and reaches the cluster
# through port-forwards, so nothing has to be exposed publicly for it.
probe_py=$ROOT/evaluation/scripts/.venv/bin/python
if [ -x "$probe_py" ]; then
  kubectl -n $NS port-forward svc/core-platform 18080:8080 >/dev/null 2>&1 &
  pf_core=$!
  kubectl -n $NS port-forward svc/analytics-service 18100:8100 >/dev/null 2>&1 &
  pf_ana=$!
  sleep 6
  if "$probe_py" "$ROOT/evaluation/scripts/tenant_isolation_probe.py" --setup-only \
       --core-host http://localhost:18080 --analytics-host http://localhost:18100; then
    note "probe users ready"
  else
    note "WARNING: probe users could not be created."
    note "QS-PER-01 and QS-PER-02 are unaffected, but QS-PER-03 would fall back"
    note "to the bootstrap admin and would not exercise tenant enforcement."
  fi
  kill $pf_core $pf_ana 2>/dev/null || true
else
  note "no venv at evaluation/scripts/.venv, skipping the probe users"
  note "QS-PER-03 needs them, create them with tenant_isolation_probe.py --setup-only"
fi

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
  before=$(kubectl -n $NS exec measurement-db-0 -- psql -U postgres -d heating_platform_measurements -tAc "select count(*) from measurements;")
  smoke_log=$(kubectl -n $NS run mock-smoke --rm -i --restart=Never --image="$REGISTRY/mock-service:latest" -- \
    run --prefix=tenanta --sites=25 --rooms=3 --interval=2 --duration=60 --broker=mosquitto:1883 --connections=4 2>&1 || true)
  printf '%s\n' "$smoke_log" | tail -3
  after=$(kubectl -n $NS exec measurement-db-0 -- psql -U postgres -d heating_platform_measurements -tAc "select count(*) from measurements;")
  note "new rows: $((after - before))  (expect roughly 60 s x 125 measurements/s at interval 2)"
  kubectl -n $NS exec measurement-db-0 -- psql -U postgres -d heating_platform_measurements -tAc \
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
  --args="run,--prefix=tenanta,--sites=25,--rooms=3,--interval=2,--duration=60,--broker=$BROKER:1883,--connections=8" \
  --quiet
# The args above are only the default; ingest-scenario.sh overrides them per
# execution, so one job serves every scenario.

step "Cloud Run query-load job"
# Same reasoning as the telemetry generator: outside the cluster, inside the
# project. query-scenario.sh redeploys it with the current endpoint IPs before
# each run, this is only so the job exists after a bring-up.
CORE_IP=$(kubectl -n $NS get svc core-platform-internal -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null)
ANALYTICS_IP=$(kubectl -n $NS get svc analytics-internal -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null)
if [ -n "$CORE_IP" ] && [ -n "$ANALYTICS_IP" ]; then
  gcloud run jobs deploy locust-load \
    --image="$REGISTRY/locust-load:latest" \
    --region="$REGION" --project="$PROJECT" \
    --network="$CLUSTER-vpc" --subnet="$CLUSTER-subnet" --vpc-egress=private-ranges-only \
    --task-timeout=3600 --max-retries=0 --cpu=2 --memory=2Gi \
    --set-env-vars="CORE_HOST=http://$CORE_IP:8080,ANALYTICS_HOST=http://$ANALYTICS_IP:8100" \
    --args="-u,50,-r,10,--run-time,10m" \
    --quiet
else
  note "internal IPs for core/analytics not ready yet, skipping the locust job"
  note "query-scenario.sh deploys it on its own before a run"
fi

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

  3. Query APIs under load (QS-PER-03). Starts an ingest base load and runs
     locust against both query APIs, both as Cloud Run jobs, so nothing has to
     be exposed publicly:
       evaluation/scripts/query-scenario.sh
     Add a tenant-bound login, otherwise tenant enforcement is not exercised:
       LOGIN_EMAIL=probe-tenanta@example.org LOGIN_PASSWORD=... \\
         evaluation/scripts/query-scenario.sh

  4. Tear down (removes both entry-point sets, then the cluster):
       infrastructure/scripts/eval-down.sh
NEXT
