#!/usr/bin/env bash
# Generates Python protobuf modules from the shared contracts in apis/proto.
# Run from applications/analytics-service; output is committed.
set -euo pipefail
cd "$(dirname "$0")/.."
.venv/bin/python -m grpc_tools.protoc \
  -I ../../apis/proto \
  --python_out=analytics_service/proto_gen \
  ../../apis/proto/core/v1/measurement_ingestion.proto \
  ../../apis/proto/detection/v1/detection_event.proto \
  ../../apis/proto/detection/v1/rule_config.proto \
  ../../apis/proto/detection/v1/anomaly_rule_config.proto \
  ../../apis/proto/device/v1/device_config.proto
touch analytics_service/proto_gen/__init__.py \
      analytics_service/proto_gen/core/__init__.py \
      analytics_service/proto_gen/core/v1/__init__.py \
      analytics_service/proto_gen/detection/__init__.py \
      analytics_service/proto_gen/detection/v1/__init__.py \
      analytics_service/proto_gen/device/__init__.py \
      analytics_service/proto_gen/device/v1/__init__.py
