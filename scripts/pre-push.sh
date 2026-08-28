#!/usr/bin/env bash

set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
KEEP_OPEN=false

usage() {
  cat <<'EOF'
Usage: ./scripts/pre-push.sh [--keep-open]

Runs the backend and frontend CI gates plus the complete Playwright suite
against isolated local services. With --keep-open, the verified app remains
available at http://localhost:18081 until Ctrl-C.
EOF
}

case "${1:-}" in
  "")
    ;;
  --keep-open)
    KEEP_OPEN=true
    ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

RUN_ID="$(date -u +%Y%m%d%H%M%S)-$$"
MIGRATION_DATABASE="becca_migration_${RUN_ID//[^a-zA-Z0-9]/_}"
TEST_SCHEMA="prepush_test_${RUN_ID//[^a-zA-Z0-9]/_}"
DATABASE_BASE_URL="postgresql://postgres:postgres@localhost:5432/becca_test"
MIGRATION_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/${MIGRATION_DATABASE}?connection_limit=5"
TEST_DATABASE_URL="${DATABASE_BASE_URL}?schema=${TEST_SCHEMA}&connection_limit=5"
BACKEND_PORT=18000
FRONTEND_PORT=18081
BOT_PORT=19100
FRONTEND_URL="http://localhost:${FRONTEND_PORT}"
BACKEND_URL="http://localhost:${BACKEND_PORT}"
BOT_TOKEN="prepush-bot-token"
ARTIFACT_DIR="${PREPUSH_ARTIFACT_DIR:-$ROOT/test-artifacts/pre-push/$RUN_ID}"
RUN_LOG="$ARTIFACT_DIR/pre-push.log"
SERVICE_LOG_DIR="$ARTIFACT_DIR/services"
PLAYWRIGHT_OUTPUT_DIR="$ARTIFACT_DIR/playwright-results"
PLAYWRIGHT_REPORT_DIR="$ARTIFACT_DIR/playwright-report"
MIGRATION_PRISMA_DIR="$ARTIFACT_DIR/migration-prisma"
PIDS=()
LAST_SERVICE_PID=""
DATABASE_RESOURCES_CREATED=false

mkdir -p "$SERVICE_LOG_DIR"
touch "$RUN_LOG"

log() {
  printf '%s\n' "$*" | tee -a "$RUN_LOG"
}

run_step() {
  local label="$1"
  local directory="$2"
  shift 2

  log ""
  log "==> $label"
  set +e
  (
    cd "$directory"
    "$@"
  ) 2>&1 | tee -a "$RUN_LOG"
  local status="${PIPESTATUS[0]}"
  set -e

  if [[ "$status" -ne 0 ]]; then
    log "FAILED: $label"
    return "$status"
  fi
}

start_service() {
  local label="$1"
  local directory="$2"
  local output="$3"
  shift 3

  (
    cd "$directory"
    exec "$@"
  ) >"$output" 2>&1 &
  local pid=$!
  PIDS+=("$pid")
  LAST_SERVICE_PID="$pid"
  log "Started $label (pid $pid, log $output)"
}

wait_for_http() {
  local label="$1"
  local url="$2"
  local pid="$3"
  local output="$4"
  local header="${5:-}"
  local curl_args=(--fail --silent --show-error)

  if [[ -n "$header" ]]; then
    curl_args+=(-H "$header")
  fi

  for _ in $(seq 1 60); do
    if ! kill -0 "$pid" 2>/dev/null; then
      log "$label exited before becoming ready."
      tail -80 "$output" | tee -a "$RUN_LOG"
      return 1
    fi
    if curl "${curl_args[@]}" "$url" >/dev/null 2>&1; then
      log "$label is ready at $url"
      return 0
    fi
    sleep 1
  done

  log "Timed out waiting for $label at $url"
  tail -80 "$output" | tee -a "$RUN_LOG"
  return 1
}

assert_port_free() {
  local port="$1"
  if ! node -e '
    const net = require("node:net");
    const server = net.createServer();
    server.once("error", () => process.exit(1));
    server.listen(Number(process.argv[1]), "127.0.0.1", () => {
      server.close(() => process.exit(0));
    });
  ' "$port"; then
    log "Port $port is already in use. Stop that process before running this gate."
    return 1
  fi
}

drop_schema() {
  local schema="$1"
  (
    cd "$ROOT"
    DOCKER_API_VERSION="${DOCKER_API_VERSION:-1.43}" \
      finch compose exec -T db \
      psql -U postgres -d becca_test -v ON_ERROR_STOP=1 \
      -c "DROP SCHEMA IF EXISTS \"$schema\" CASCADE;" >/dev/null
  )
}

create_database() {
  local database="$1"
  (
    cd "$ROOT"
    DOCKER_API_VERSION="${DOCKER_API_VERSION:-1.43}" \
      finch compose exec -T db \
      psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
      -c "CREATE DATABASE \"$database\";" >/dev/null
  )
}

drop_database() {
  local database="$1"
  (
    cd "$ROOT"
    DOCKER_API_VERSION="${DOCKER_API_VERSION:-1.43}" \
      finch compose exec -T db \
      psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
      -c "DROP DATABASE IF EXISTS \"$database\" WITH (FORCE);" >/dev/null
  )
}

prepare_migration_archive() {
  mkdir -p "$MIGRATION_PRISMA_DIR/migrations"
  cp "$BACKEND/prisma/schema.prisma" "$MIGRATION_PRISMA_DIR/schema.prisma"

  if [[ -f "$BACKEND/prisma/migrations/migration_lock.toml" ]]; then
    cp "$BACKEND/prisma/migrations/migration_lock.toml" \
      "$MIGRATION_PRISMA_DIR/migrations/migration_lock.toml"
  fi

  local migration
  for migration in "$BACKEND"/prisma/migrations/*; do
    if [[ -f "$migration/migration.sql" ]]; then
      cp -R "$migration" "$MIGRATION_PRISMA_DIR/migrations/"
    fi
  done
}

cleanup() {
  local status=$?
  trap - EXIT

  if [[ "${#PIDS[@]}" -gt 0 ]]; then
    kill "${PIDS[@]}" 2>/dev/null || true
    for pid in "${PIDS[@]}"; do
      wait "$pid" 2>/dev/null || true
    done
  fi

  if [[ "$DATABASE_RESOURCES_CREATED" == true ]]; then
    drop_schema "$TEST_SCHEMA" || log "Warning: could not drop $TEST_SCHEMA"
    drop_database "$MIGRATION_DATABASE" ||
      log "Warning: could not drop $MIGRATION_DATABASE"
  fi

  if [[ "$status" -eq 0 ]]; then
    log ""
    log "PRE-PUSH GATE PASSED"
    log "Artifacts: $ARTIFACT_DIR"
  else
    log ""
    log "PRE-PUSH GATE FAILED (exit $status)"
    log "Inspect: $RUN_LOG"
    log "Playwright report: $PLAYWRIGHT_REPORT_DIR/index.html"
  fi

  exit "$status"
}

trap cleanup EXIT
trap 'exit 130' INT TERM

for command in node npm npx curl finch; do
  if ! command -v "$command" >/dev/null 2>&1; then
    log "Missing required command: $command"
    exit 1
  fi
done

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [[ "$NODE_MAJOR" -lt 24 ]]; then
  log "Node.js 24 or newer is required; found $(node --version)."
  exit 1
fi

if [[ ! -x "$BACKEND/node_modules/.bin/prisma" ]] ||
   [[ ! -x "$FRONTEND/node_modules/.bin/playwright" ]]; then
  log "Dependencies are missing. Run ./setup.sh first."
  exit 1
fi

assert_port_free "$BACKEND_PORT"
assert_port_free "$FRONTEND_PORT"
assert_port_free "$BOT_PORT"

log "BECCA pre-push gate"
log "Run: $RUN_ID"
log "Migration database: $MIGRATION_DATABASE"
log "Test schema: $TEST_SCHEMA"
log "Artifacts: $ARTIFACT_DIR"

run_step "Start local PostgreSQL" "$ROOT" \
  env DOCKER_API_VERSION="${DOCKER_API_VERSION:-1.43}" \
  finch compose up -d db

for _ in $(seq 1 30); do
  if (
    cd "$ROOT"
    DOCKER_API_VERSION="${DOCKER_API_VERSION:-1.43}" \
      finch compose exec -T db \
      pg_isready -U postgres -d becca_test >/dev/null 2>&1
  ); then
    DATABASE_RESOURCES_CREATED=true
    break
  fi
  sleep 1
done

if [[ "$DATABASE_RESOURCES_CREATED" != true ]]; then
  log "PostgreSQL did not become ready."
  exit 1
fi

run_step "Create isolated migration database" "$ROOT" \
  create_database "$MIGRATION_DATABASE"

run_step "Stage executable migration history" "$ROOT" \
  prepare_migration_archive

run_step "Apply production migrations" "$BACKEND" \
  env DATABASE_URL="$MIGRATION_DATABASE_URL" \
  DIRECT_URL="$MIGRATION_DATABASE_URL" \
  JWT_SECRET="prepush-test-secret" \
  npx prisma migrate deploy --schema "$MIGRATION_PRISMA_DIR/schema.prisma"

run_step "Verify migrations match Prisma schema" "$BACKEND" \
  env DATABASE_URL="$MIGRATION_DATABASE_URL" \
  DIRECT_URL="$MIGRATION_DATABASE_URL" \
  JWT_SECRET="prepush-test-secret" \
  npx prisma migrate diff \
  --from-url "$MIGRATION_DATABASE_URL" \
  --to-schema-datamodel "$MIGRATION_PRISMA_DIR/schema.prisma" \
  --exit-code

run_step "Prepare isolated test schema" "$BACKEND" \
  env NODE_ENV=test \
  DATABASE_URL="$TEST_DATABASE_URL" \
  DIRECT_URL="$TEST_DATABASE_URL" \
  node scripts/prepareTestDatabase.js

run_step "Backend typecheck" "$BACKEND" npm run typecheck
run_step "Backend build" "$BACKEND" npm run build
run_step "Backend unit tests" "$BACKEND" \
  env TEST_DATABASE_URL="$TEST_DATABASE_URL" \
  DATABASE_URL="$TEST_DATABASE_URL" \
  DIRECT_URL="$TEST_DATABASE_URL" \
  JWT_SECRET="prepush-test-secret" \
  npx jest --selectProjects unit
run_step "Backend integration tests" "$BACKEND" \
  env TEST_DATABASE_URL="$TEST_DATABASE_URL" \
  DATABASE_URL="$TEST_DATABASE_URL" \
  DIRECT_URL="$TEST_DATABASE_URL" \
  JWT_SECRET="prepush-test-secret" \
  npx jest --selectProjects integration --runInBand

run_step "Frontend typecheck" "$FRONTEND" npm run typecheck
run_step "Frontend lint" "$FRONTEND" npm run lint
run_step "Frontend build metadata tests" "$FRONTEND" npm run test:build-metadata
run_step "Frontend unit tests with coverage" "$FRONTEND" npm run test:coverage
run_step "Frontend build" "$FRONTEND" npm run build

BOT_LOG="$SERVICE_LOG_DIR/bot.log"
BACKEND_LOG="$SERVICE_LOG_DIR/backend.log"
FRONTEND_LOG="$SERVICE_LOG_DIR/frontend.log"

start_service "bot stub" "$BACKEND" "$BOT_LOG" \
  env PORT="$BOT_PORT" BOT_SERVICE_TOKEN="$BOT_TOKEN" \
  "$BACKEND/node_modules/.bin/ts-node" tests/helpers/runBotServiceStub.ts
BOT_PID="$LAST_SERVICE_PID"
wait_for_http "Bot stub" \
  "http://127.0.0.1:${BOT_PORT}/ready?tier=facile" \
  "$BOT_PID" "$BOT_LOG" "Authorization: Bearer $BOT_TOKEN"

start_service "backend" "$BACKEND" "$BACKEND_LOG" \
  env NODE_ENV=test \
  PORT="$BACKEND_PORT" \
  DATABASE_URL="$TEST_DATABASE_URL" \
  DIRECT_URL="$TEST_DATABASE_URL" \
  JWT_SECRET="prepush-test-secret" \
  ANNOTATION_ACCESS_CODE="becca-expert" \
  FRONTEND_URL="$FRONTEND_URL" \
  BOT_SERVICE_URL="http://127.0.0.1:${BOT_PORT}" \
  BOT_SERVICE_TOKEN="$BOT_TOKEN" \
  BOT_THINK_DELAY_MS=100000 \
  node dist/index.js
BACKEND_PID="$LAST_SERVICE_PID"
wait_for_http "Backend" "$BACKEND_URL/health" "$BACKEND_PID" "$BACKEND_LOG"

start_service "frontend" "$FRONTEND" "$FRONTEND_LOG" \
  env VITE_API_URL="$BACKEND_URL/api" \
  VITE_SOCKET_URL="$BACKEND_URL" \
  "$FRONTEND/node_modules/.bin/vite" \
  --host 127.0.0.1 --port "$FRONTEND_PORT" --strictPort
FRONTEND_PID="$LAST_SERVICE_PID"
wait_for_http "Frontend" "$FRONTEND_URL" "$FRONTEND_PID" "$FRONTEND_LOG"

run_step "Playwright end-to-end tests" "$FRONTEND" \
  env E2E_EXTERNAL_SERVERS=true \
  E2E_BASE_URL="$FRONTEND_URL" \
  E2E_API_URL="$BACKEND_URL" \
  E2E_DATABASE_URL="$TEST_DATABASE_URL" \
  PLAYWRIGHT_OUTPUT_DIR="$PLAYWRIGHT_OUTPUT_DIR" \
  PLAYWRIGHT_REPORT_DIR="$PLAYWRIGHT_REPORT_DIR" \
  npx playwright test

if [[ "$KEEP_OPEN" == true ]]; then
  log ""
  log "Verified stack is running at $FRONTEND_URL"
  log "Press Ctrl-C to stop services and remove the temporary schemas."
  while kill -0 "$BACKEND_PID" "$FRONTEND_PID" "$BOT_PID" 2>/dev/null; do
    sleep 2
  done
  log "A verified service exited unexpectedly."
  exit 1
fi
