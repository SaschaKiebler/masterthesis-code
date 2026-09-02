# Query-API load generator (QS-PER-03) as a container, so the measurement runs
# as a Cloud Run job in the cluster's region instead of from an operator's
# laptop. That keeps the generator outside the cluster, as the profile requires,
# without making the operator's uplink and machine part of the measurement.
FROM python:3.12-slim AS runtime

WORKDIR /app

RUN pip install --no-cache-dir "locust>=2.20"

COPY locustfile.py /app/locustfile.py
COPY security_locustfile.py /app/security_locustfile.py
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Hosts and credentials come from the environment, run parameters as arguments:
#   -u 50 -r 10 --run-time 10m
# LOCUST_FILE selects the scenario (default locustfile.py; security_locustfile.py
# for QS-SEC-01 cross-tenant attacks through the frontend proxy).
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["-u", "50", "-r", "10", "--run-time", "10m"]
