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

step "Release the persistent volumes"
# Destroying the cluster does NOT delete the disks its CSI driver created: the
# PVCs vanish with the cluster before anything can reclaim them, and every
# session then leaves ~30 GB of orphaned pd-balanced behind. Fourteen of those
# once filled the regional SSD_TOTAL_GB quota and made a later bring-up fail
# with volumes that would not bind. Deleting the PVCs first lets the driver
# clean up while it still can.
if kubectl -n $NS get pvc --no-headers 2>/dev/null | grep -q .; then
  kubectl -n $NS delete statefulset --all --cascade=foreground --timeout=180s 2>/dev/null || true
  kubectl -n $NS delete pvc --all --timeout=180s 2>/dev/null || true
  sleep 20
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
  # Terraform refreshes before it destroys, and that refresh has been seen to
  # die on a transient "http2: client connection lost". It then exits without
  # destroying anything, so retry rather than trust a single attempt.
  for attempt in 1 2 3; do
    if terraform -chdir="$ROOT/infrastructure/terraform" destroy -auto-approve \
         -target=google_container_cluster.cluster -var project_id="$PROJECT"; then
      break
    fi
    echo "    destroy attempt $attempt failed, retrying in 30 s"
    sleep 30
  done
fi

step "Verify"
# Never report success from an exit code alone: ask GCP what is actually left.
# A cluster that survives a failed teardown keeps billing silently.
if [ -n "$(gcloud container clusters list --project "$PROJECT" --format='value(name)' 2>/dev/null)" ]; then
  echo
  echo "FAILED: the cluster still exists. It is still costing money."
  echo "Re-run this script, or destroy it by hand:"
  echo "  terraform -chdir=infrastructure/terraform destroy -target=google_container_cluster.cluster -var project_id=$PROJECT"
  exit 1
fi
echo "    cluster gone"

step "Check for leftovers that would keep billing"
leftover=$(gcloud compute forwarding-rules list --project "$PROJECT" --format="value(name,region,IPAddress)" 2>/dev/null)
if [ -n "$leftover" ]; then
  echo "WARNING: forwarding rules survived the cluster, delete them by hand:"
  echo "$leftover"
else
  echo "    no forwarding rules left"
fi
# Persistent disks the CSI driver did not reclaim before the cluster went.
# Deleting the PVCs first (above) usually suffices, but on 2026-09-03 three
# unattached pvc-* disks survived anyway. Unattached and named pvc-, so they
# can only be leftovers of a cluster that no longer exists.
orphans=$(gcloud compute disks list --project "$PROJECT" \
  --filter='name~^pvc- AND -users:*' --format='value(name,zone.basename())' 2>/dev/null || true)
if [ -n "$orphans" ]; then
  echo "$orphans" | while IFS=$'\t' read -r name zone; do
    [ -n "$name" ] || continue
    gcloud compute disks delete "$name" --zone "$zone" --project "$PROJECT" --quiet >/dev/null 2>&1 \
      && echo "    deleted orphaned disk $name" || echo "    could not delete disk $name ($zone)"
  done
else
  echo "    no orphaned disks left"
fi
echo "    images kept in:"
gcloud artifacts repositories list --project "$PROJECT" --format="value(name,format)" 2>/dev/null || true
