FROM python:3.12-slim AS runtime

WORKDIR /app

COPY pyproject.toml README.md ./
COPY src ./src
COPY scenarios ./scenarios

RUN pip install --no-cache-dir .

# Typical usage:
#   docker run ... mock-service seed --dsn postgresql://...
#   docker run ... mock-service run --broker mosquitto:1883 --sites 10 --rooms 3
ENTRYPOINT ["mock-service"]
CMD ["run"]
