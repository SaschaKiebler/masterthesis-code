#!/usr/bin/env bash
#
# Local dev stack for the heating-monitoring platform.
#
#   scripts/dev.sh up        start infra (docker) + all services (background)
#   scripts/dev.sh down      stop all services and the docker infra
#   scripts/dev.sh status    show what is running
#   scripts/dev.sh logs <svc> tail a service log (core|device|notify|ingest|analytics|frontend)
#
# Services and ports:
#   TimescaleDB   localhost:5432      Kafka        localhost:9092
#   Mosquitto     localhost:1883      Kafka UI     localhost:8081
#   core-platform localhost:8080      device-mgmt  localhost:8082
#   notification  localhost:8083      analytics    localhost:8100
#   frontend      localhost:3000      ingestion    (no port, MQTT consumer)
#
# Telemetry is NOT started automatically. After `up`, seed + run the mock fleet:
#   applications/mock-service/.venv/bin/mock-service seed --sites 2 --rooms 2
#   applications/mock-service/.venv/bin/mock-service run  --sites 2 --rooms 2 --interval 10

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APPS="$ROOT/applications"
COMPOSE_FILE="$ROOT/docker/docker-compose-kafka.yaml"
RUN_DIR="$ROOT/.dev"
LOG_DIR="$RUN_DIR/logs"
PID_DIR="$RUN_DIR/pids"

SERVICES=(core device notify ingest analytics frontend)

# ── helpers ──────────────────────────────────────────────────────────────────

log()  { printf '\033[1;34m[dev]\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m[dev]\033[0m %s\n' "$*" >&2; }

port_open() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && exec 3>&- 3<&-; }

wait_port() { # wait_port <name> <port> <timeout-seconds>
  local name=$1 port=$2 timeout=$3 waited=0
  printf '[dev] waiting for %s (port %s) ' "$name" "$port"
  until port_open "$port"; do
    sleep 2; waited=$((waited + 2)); printf '.'
    if (( waited >= timeout )); then
      printf '\n'; err "$name did not open port $port within ${timeout}s (see $LOG_DIR)"; return 1
    fi
  done
  printf ' up\n'
}

# Export KEY=VALUE pairs from a .env file. Deliberately not `source`d:
# values with spaces (e.g. N8N_SERVICE_DISPLAY_NAME=n8n Service User) would
# be executed as commands.
load_env() {
  local line key value
  while IFS= read -r line || [[ -n $line ]]; do
    [[ $line =~ ^[[:space:]]*(#|$) ]] && continue
    key=${line%%=*}; value=${line#*=}
    [[ $key =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    export "$key=$value"
  done < "$1"
}

# Start a command in the background, loading the service's .env if present.
start_bg() { # start_bg <name> <workdir> <cmd...>
  local name=$1 dir=$2; shift 2
  if [[ -f "$PID_DIR/$name.pid" ]] && kill -0 "$(cat "$PID_DIR/$name.pid")" 2>/dev/null; then
    log "$name already running (pid $(cat "$PID_DIR/$name.pid"))"
    return 0
  fi
  log "starting $name  →  $LOG_DIR/$name.log"
  (
    cd "$dir"
    [[ -f .env ]] && load_env .env
    exec "$@"
  ) >"$LOG_DIR/$name.log" 2>&1 &
  echo $! > "$PID_DIR/$name.pid"
}

kill_tree() { # kill a pid and all its descendants (gradle/JVM, next dev workers)
  local pid=$1 child
  for child in $(pgrep -P "$pid" 2>/dev/null); do
    kill_tree "$child"
  done
  kill "$pid" 2>/dev/null || true
}

stop_bg() { # stop_bg <name>
  local name=$1
  local pidfile="$PID_DIR/$name.pid"
  local pid
  [[ -f "$pidfile" ]] || return 0
  pid=$(cat "$pidfile")
  if kill -0 "$pid" 2>/dev/null; then
    log "stopping $name (pid $pid)"
    kill_tree "$pid"
  fi
  rm -f "$pidfile"
}

# ── commands ─────────────────────────────────────────────────────────────────

cmd_up() {
  mkdir -p "$LOG_DIR" "$PID_DIR"

  log "starting docker infra (kafka, kafka-ui, mosquitto, timescaledb)"
  docker compose -f "$COMPOSE_FILE" up -d

  # infra readiness
  local waited=0
  printf '[dev] waiting for timescaledb '
  until docker compose -f "$COMPOSE_FILE" exec -T timescaledb pg_isready -U postgres -d digital_demon >/dev/null 2>&1; do
    sleep 2; waited=$((waited + 2)); printf '.'
    if (( waited >= 60 )); then printf '\n'; err "timescaledb not ready after 60s"; exit 1; fi
  done
  printf ' up\n'
  wait_port kafka 9092 60
  wait_port mosquitto 1883 30

  # one-time setup where needed
  if [[ ! -d "$APPS/analytics-service/.venv" ]]; then
    log "creating analytics-service venv"
    python3 -m venv "$APPS/analytics-service/.venv"
    "$APPS/analytics-service/.venv/bin/pip" install -e "$APPS/analytics-service" >"$LOG_DIR/analytics-setup.log" 2>&1
  fi
  if [[ ! -d "$APPS/frontend/node_modules" ]]; then
    log "installing frontend dependencies"
    (cd "$APPS/frontend" && npm install) >"$LOG_DIR/frontend-setup.log" 2>&1
  fi

  # core-platform first: it owns the DB schema (Flyway) and its Kafka topics
  start_bg core "$APPS/core-platform" ./gradlew bootRun
  wait_port core-platform 8080 300

  # everything else only needs infra + the migrated schema. Notification now
  # has its own table area in the shared DB (own Flyway history table) and
  # therefore starts after core like the rest; analytics runs the threshold
  # evaluation and the weather-context detector on the measurement path.
  start_bg device    "$APPS/device-management"     ./gradlew bootRun
  start_bg notify    "$APPS/notification-service"  ./gradlew bootRun
  start_bg ingest    "$APPS/ingestion-service"     cargo run
  start_bg analytics "$APPS/analytics-service"     .venv/bin/uvicorn analytics_service.main:app --port 8100
  start_bg frontend  "$APPS/frontend"              npm run dev

  wait_port device-management 8082 300
  wait_port notification-service 8083 300
  wait_port analytics-service 8100 120
  wait_port frontend 3000 120

  cat <<EOF

  ── local stack is up ────────────────────────────────────────────
  Frontend        http://localhost:3000   (login admin@local / admin)
  Core platform   http://localhost:8080
  Device mgmt     http://localhost:8082
  Notification    http://localhost:8083   (Meldungen + Regeln, DB-backed)
  Analytics       http://localhost:8100
  Kafka UI        http://localhost:8081

  Logs:    scripts/dev.sh logs <core|device|notify|ingest|analytics|frontend>
  Stop:    scripts/dev.sh down

  To generate telemetry:
    applications/mock-service/.venv/bin/mock-service seed --sites 2 --rooms 2
    applications/mock-service/.venv/bin/mock-service run  --sites 2 --rooms 2 --interval 10
  ─────────────────────────────────────────────────────────────────
EOF
}

cmd_down() {
  for svc in frontend analytics ingest notify device core; do
    stop_bg "$svc"
  done
  # gradle bootRun runs the app inside the daemon on some setups; make sure
  # nothing keeps the ports occupied
  for port in 8080 8082 8083; do
    if port_open "$port"; then
      lsof -ti tcp:"$port" | xargs kill 2>/dev/null || true
    fi
  done
  log "stopping docker infra"
  docker compose -f "$COMPOSE_FILE" stop
  log "done (db volume kept; 'docker compose -f docker/docker-compose-kafka.yaml down -v' wipes it)"
}

cmd_status() {
  docker compose -f "$COMPOSE_FILE" ps 2>/dev/null || true
  echo
  local svc pid state
  for svc in "${SERVICES[@]}"; do
    state="stopped"
    if [[ -f "$PID_DIR/$svc.pid" ]]; then
      pid=$(cat "$PID_DIR/$svc.pid")
      kill -0 "$pid" 2>/dev/null && state="running (pid $pid)"
    fi
    printf '  %-10s %s\n' "$svc" "$state"
  done
}

cmd_logs() {
  local svc=${1:-}
  [[ -n "$svc" && -f "$LOG_DIR/$svc.log" ]] || { err "usage: dev.sh logs <${SERVICES[*]}>"; exit 1; }
  tail -f "$LOG_DIR/$svc.log"
}

case "${1:-}" in
  up)     cmd_up ;;
  down)   cmd_down ;;
  status) cmd_status ;;
  logs)   shift; cmd_logs "$@" ;;
  *)      sed -n '2,19p' "$0"; exit 1 ;;
esac
