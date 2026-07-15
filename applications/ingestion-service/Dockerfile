# Build context: repo root (heizungs-plattform/)
# Usage: docker build -f applications/ingestion-service/Dockerfile .

# ── Stage 1: Build ──────────────────────────────────────────────────
FROM rust:1.84-bookworm AS builder

# Mirror repo structure so build.rs relative paths (../../apis/proto/) resolve correctly:
#   /workspace/applications/ingestion-service/../../apis/proto/ = /workspace/apis/proto/ ✓
WORKDIR /workspace/applications/ingestion-service

# Limit parallelism to avoid OOM on small VPSes
ENV CARGO_BUILD_JOBS=2

# protoc — required by prost-build to compile .proto files
# cmake — required by rdkafka's cmake-build feature (compiles bundled librdkafka)
RUN apt-get update && apt-get install -y --no-install-recommends \
    protobuf-compiler \
    cmake \
    && rm -rf /var/lib/apt/lists/*

# Copy proto definitions (referenced by build.rs via ../../apis/proto/)
COPY apis/ /workspace/apis/

# Cache dependencies: copy manifests + build script first, then build a dummy binary.
# build.rs must be present so prost generates core.v1.rs into OUT_DIR during the
# dependency cache phase — the generated file survives the src/ deletion below.
COPY applications/ingestion-service/Cargo.toml applications/ingestion-service/Cargo.lock ./
COPY applications/ingestion-service/build.rs ./
RUN mkdir src && echo 'fn main() {}' > src/main.rs
RUN cargo build --release 2>&1 && rm -rf src target/release/deps/ingestion_service*

# Copy real source and build
COPY applications/ingestion-service/src/ src/
RUN cargo build --release 2>&1

# ── Stage 2: Runtime ────────────────────────────────────────────────
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /workspace/applications/ingestion-service/target/release/ingestion-service /usr/local/bin/ingestion-service

# Non-root user
RUN useradd --create-home --shell /bin/bash appuser
USER appuser

ENV RUST_LOG=ingestion_service=info

ENTRYPOINT ["ingestion-service"]
