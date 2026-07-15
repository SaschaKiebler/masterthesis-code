# Build context: repo root (masterthesis-code/)
# Usage: docker build -f applications/device-management/Dockerfile .

# ── Stage 1: Build ──────────────────────────────────────────────────
FROM eclipse-temurin:21-jdk-jammy AS builder

WORKDIR /app

# Copy Gradle wrapper and build files
COPY applications/device-management/gradlew applications/device-management/gradlew.bat ./
COPY applications/device-management/gradle/ gradle/
COPY applications/device-management/build.gradle.kts applications/device-management/settings.gradle.kts ./

# Copy proto definitions (needed by protobuf plugin)
COPY apis/proto/ apis/proto/

# Adjust proto source path for flat Docker layout
RUN sed -i 's|../../apis/proto|apis/proto|' build.gradle.kts

# Copy source
COPY applications/device-management/src/ src/

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

EXPOSE 8082

ENV JAVA_OPTS="-Xmx512m -Xms128m"

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
