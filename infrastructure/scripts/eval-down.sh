#!/usr/bin/env bash
# Tear the evaluation environment down.
#
# By default ONLY the GKE cluster goes, which is the part that actually costs
# money per hour. The Artifact Registry, VPC and subnet stay, so the next
# session starts from the images that are already built.
#
#   ./eval-down.sh          destroy the cluster (default)
#   ./eval-down.sh --all    destroy everything, INCLUDING the Artifact Registry
#                           and every image in it. A following session then
#                           needs a full cloudbuild-all.sh run first.
#
# Order matters: the LoadBalancer services from eval/external-access.yaml must
# go BEFORE the cluster, otherwise GKE's forwarding rules can outlive it and
# keep billing (see infrastructure/README.md).
set -euo pipefail

PROJECT=${PROJECT:-heating-platform-eval}
NS=heating-platform
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
MODE=${1:-cluster}

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

step "Remove the session entry points (external and internal)"
# The label key is what matters: eval=external are the public LoadBalancers,
# eval=internal the VPC-only ones the Cloud Run generators use.
if kubectl -n $NS get svc -l eval --no-headers 2>/dev/null | grep -q .; then
  kubectl -n $NS delete svc -l eval
  # Give GKE a moment to release the forwarding rules before the cluster goes.
  sleep 30
else
  echo "    none present"
fi

if [ "$MODE" = "--all" ]; then
  step "Destroy EVERYTHING (cluster, network, registry and all images)"
  # The generator job pins the VPC, so it has to go before the network does.
  gcloud run jobs delete mock-load --region="${REGION:-europe-west3}" --project="$PROJECT" --quiet 2>/dev/null || true
  terraform -chdir="$ROOT/infrastructure/terraform" destroy -auto-approve -var project_id="$PROJECT"
else
  step "Destroy the cluster only (registry and network stay)"
  terraform -chdir="$ROOT/infrastructure/terraform" destroy -auto-approve \
    -target=google_container_cluster.cluster -var project_id="$PROJECT"
fi

step "Check for leftovers that would keep billing"
gcloud compute forwarding-rules list --project "$PROJECT" --format="table(name,region,IPAddress)" 2>/dev/null || true
gcloud artifacts repositories list --project "$PROJECT" --format="table(name,format)" 2>/dev/null || true
