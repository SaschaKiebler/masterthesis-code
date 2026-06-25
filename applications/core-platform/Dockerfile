# Build context: repo root (heizungs-plattform/)
# Usage: docker build -f applications/core-platform/Dockerfile .

# ── Stage 1: Build ──────────────────────────────────────────────────
FROM eclipse-temurin:21-jdk-jammy AS builder

WORKDIR /app

# Copy Gradle wrapper and build files
COPY applications/core-platform/gradlew applications/core-platform/gradlew.bat ./
COPY applications/core-platform/gradle/ gradle/
COPY applications/core-platform/build.gradle.kts applications/core-platform/settings.gradle.kts ./

# Copy proto definitions (needed by protobuf plugin)
COPY apis/proto/ apis/proto/

# Adjust proto source path for flat Docker layout
RUN sed -i 's|../../apis/proto|apis/proto|' build.gradle.kts

# Copy source
COPY applications/core-platform/src/ src/

# Build
RUN chmod +x gradlew && \
    ./gradlew bootJar -x test --no-daemon

# ── Stage 2: Runtime ────────────────────────────────────────────────
FROM eclipse-temurin:21-jre-jammy

WORKDIR /app

COPY --from=builder /app/build/libs/*.jar app.jar

# Install curl for Docker healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Non-root user
RUN useradd --create-home --shell /bin/bash appuser
USER appuser

EXPOSE 8080 9090

ENV JAVA_OPTS="-Xmx2g -Xms512m"

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
