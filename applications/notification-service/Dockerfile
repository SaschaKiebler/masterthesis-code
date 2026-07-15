# Build context: repo root (masterthesis-code/)
# Usage: docker build -f applications/notification-service/Dockerfile .

# ── Stage 1: Build ──────────────────────────────────────────────────
FROM eclipse-temurin:21-jdk-jammy AS builder

WORKDIR /app

# Copy Gradle wrapper and build files
COPY applications/notification-service/gradlew applications/notification-service/gradlew.bat ./
COPY applications/notification-service/gradle/ gradle/
COPY applications/notification-service/build.gradle.kts applications/notification-service/settings.gradle.kts ./

# Copy proto definitions (needed by protobuf plugin)
COPY apis/proto/ apis/proto/

# Adjust proto source path for flat Docker layout
RUN sed -i 's|../../apis/proto|apis/proto|' build.gradle.kts

# Copy source
COPY applications/notification-service/src/ src/

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

EXPOSE 8083

ENV JAVA_OPTS="-Xmx256m -Xms128m"

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
