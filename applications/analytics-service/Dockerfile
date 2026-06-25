FROM python:3.12-slim AS builder
WORKDIR /app
# Install dependencies first (cached unless pyproject.toml changes)
COPY applications/analytics-service/pyproject.toml .
RUN mkdir -p analytics_service && touch analytics_service/__init__.py && \
    pip install --no-cache-dir .

FROM python:3.12-slim
WORKDIR /app
COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin/uvicorn /usr/local/bin/uvicorn
# Copy source code last (changes frequently, but deps are cached)
COPY applications/analytics-service/analytics_service ./analytics_service
EXPOSE 8100
CMD ["uvicorn", "analytics_service.main:app", "--host", "0.0.0.0", "--port", "8100"]
