#!/bin/sh
# Run the query-API load profile headless and make its results retrievable.
#
# A Cloud Run job has no filesystem anyone can fetch afterwards, so the CSVs
# locust writes are echoed to stdout between markers. The runner script picks
# them back out of Cloud Logging and stores them under evaluation/results/.
set -u

PREFIX=/tmp/qs-per-03
# Deliberately not `set -e`: locust exits non-zero when its failure threshold
# trips, and exactly that run is the one whose numbers we need to see.
status=0
locust -f /app/locustfile.py --headless --csv "$PREFIX" "$@" || status=$?

for part in stats failures stats_history; do
  file="${PREFIX}_${part}.csv"
  [ -f "$file" ] || continue
  echo "===== CSV BEGIN ${part} ====="
  cat "$file"
  echo "===== CSV END ${part} ====="
done

# Locust exits non-zero as soon as ANY request failed, and a run with failures
# is exactly the run whose numbers matter. Report success when statistics were
# produced, and fail only when locust could not run at all. Otherwise the job
# looks failed to Cloud Run and the caller throws away a valid measurement.
if [ -s "${PREFIX}_stats.csv" ]; then
  echo "locust exit status was ${status}; statistics were produced, treating the run as complete"
  exit 0
fi
echo "no statistics were produced, locust exit status ${status}" >&2
exit "${status:-1}"
