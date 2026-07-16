#!/usr/bin/env bash
# Build and push all platform images to a registry (Artifact Registry).
#
# Usage:
#   ./build-push.sh <registry> [tag]
#   ./build-push.sh europe-west3-docker.pkg.dev/my-project/heating-platform v1
#
# One-time docker auth for Artifact Registry:
#   gcloud auth configure-docker europe-west3-docker.pkg.dev
#
# GKE nodes are amd64; on Apple Silicon this cross-builds via buildx
# (override with PLATFORM=linux/arm64 for local clusters).
set -euo pipefail

REGISTRY=${1:?usage: build-push.sh <registry> [tag]}
TAG=${2:-latest}
PLATFORM=${PLATFORM:-linux/amd64}

REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$REPO_ROOT"

# repo-root build context (Dockerfiles copy apis/proto/)
ROOT_CONTEXT_SERVICES=(ingestion-service core-platform device-management notification-service)

for svc in "${ROOT_CONTEXT_SERVICES[@]}"; do
  echo "==> $svc"
  docker build --platform "$PLATFORM" \
    -f "applications/$svc/Dockerfile" \
    -t "$REGISTRY/$svc:$TAG" .
  docker push "$REGISTRY/$svc:$TAG"
done

echo "==> mock-service"
docker build --platform "$PLATFORM" \
  -t "$REGISTRY/mock-service:$TAG" applications/mock-service
docker push "$REGISTRY/mock-service:$TAG"

echo "done: 5 images pushed to $REGISTRY (tag $TAG)"
