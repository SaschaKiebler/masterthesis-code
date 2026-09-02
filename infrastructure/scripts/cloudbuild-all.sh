#!/usr/bin/env bash
# Rebuild every platform image on Cloud Build (no local Docker needed).
#
# The repo tarball is ~190 MiB, so it is uploaded ONCE and the remaining
# builds are pointed at that same GCS object instead of re-uploading per
# service. All builds run concurrently; the script waits for all of them.
#
#   ./cloudbuild-all.sh              all eight images
#   ./cloudbuild-all.sh core-platform ingestion-service   only these
set -euo pipefail

PROJECT=${PROJECT:-heating-platform-eval}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
CONFIG=$ROOT/infrastructure/cloudbuild.yaml
MACHINE=${MACHINE:-E2_HIGHCPU_8}   # the Rust build is slow on the default machine

ALL=(ingestion-service core-platform device-management notification-service analytics-service frontend mock-service locust-load)
SERVICES=("${@:-}")
[ -z "${SERVICES[0]:-}" ] && SERVICES=("${ALL[@]}")

# Two images copy paths relative to their own directory rather than the repo
# root, and one of them does not live under applications/ at all.
context_for() {
  case "$1" in
    mock-service) echo "applications/mock-service" ;;
    locust-load)  echo "evaluation/load" ;;
    *)            echo "." ;;
  esac
}
dockerfile_for() {
  case "$1" in
    locust-load) echo "evaluation/load/Dockerfile" ;;
    *)           echo "applications/$1/Dockerfile" ;;
  esac
}

cd "$ROOT"
first=${SERVICES[0]}
echo "==> $first (uploads the source)"
out=$(gcloud builds submit . --config "$CONFIG" --project "$PROJECT" \
  --substitutions _SERVICE="$first",_CONTEXT="$(context_for "$first")",_DOCKERFILE="$(dockerfile_for "$first")" \
  --timeout=40m --machine-type="$MACHINE" --async --format="value(id)" 2>&1)
echo "$out" | tail -1
SRC=$(echo "$out" | grep -o "gs://[^]]*\.tgz" | tail -1)
[ -n "$SRC" ] || { echo "could not determine the uploaded source URI"; exit 1; }

for svc in "${SERVICES[@]:1}"; do
  echo "==> $svc (reusing $SRC)"
  gcloud builds submit "$SRC" --config "$CONFIG" --project "$PROJECT" \
    --substitutions _SERVICE="$svc",_CONTEXT="$(context_for "$svc")",_DOCKERFILE="$(dockerfile_for "$svc")" \
    --timeout=40m --machine-type="$MACHINE" --async --format="value(id)"
done

echo "==> waiting for all builds"
while [ "$(gcloud builds list --project "$PROJECT" --filter='status=(QUEUED,WORKING)' --format='value(id)' | wc -l | tr -d ' ')" != "0" ]; do
  sleep 30
done
gcloud builds list --project "$PROJECT" --limit="${#SERVICES[@]}" \
  --format="table(substitutions._SERVICE,status,duration)"
