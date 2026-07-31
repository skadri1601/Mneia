#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
LOG_ROOT="${MNEIA_LOG_ROOT:-$REPO_ROOT/logs}"
LOG_DIR="$LOG_ROOT/$RUN_ID"
RUN_LOG="$LOG_DIR/run.log"

SITE_PORT="${SITE_PORT:-3000}"
DEBUG="${MNEIA_DEBUG:-0}"
HEALTH_TIMEOUT="${MNEIA_HEALTH_TIMEOUT:-90}"
NO_COLOR="${NO_COLOR:-0}"
SKIP_INSTALL=0
QUIET=0
FRESH=0

SERVICE_NAMES=()
SERVICE_PIDS=()
MIRROR_PIDS=()
SHUTTING_DOWN=0

usage() {
  cat <<'EOF'
run.sh — start every Mneia service locally, with traceable logs.

USAGE
  ./run.sh [options]

OPTIONS
  --port <n>          Port for the web site        (default 3000, or $SITE_PORT)
  --debug             Verbose logging, and echo every command the script runs
  --health-timeout <n>  Seconds to wait for a service to answer  (default 90)
  --skip-install      Do not run "pnpm install" during preflight
  --fresh             Delete apps/site/.next before starting. Use this after running a
                      production build ("pnpm --filter @mneia/site build"), which overwrites
                      the same directory the dev server reads and leaves it desynced —
                      the symptom is "Cannot find module './NNN.js'" from webpack-runtime.
  --quiet             Write logs to disk but do not mirror service output to the console
  --no-color          Disable ANSI colour
  --clean             Delete previous run directories under logs/ and exit
  -h, --help          This message

LOGS
  Every run writes to logs/<UTC timestamp>/ :
    run.log           The orchestrator's own log — preflight, health, lifecycle, exit codes
    <service>.log     That service's complete stdout and stderr, unfiltered
  logs/latest holds the path of the most recent run directory.

  Log lines from this script are:  <ISO-8601 UTC> [LEVEL] [component] message
  Service output is copied verbatim into <service>.log so line numbers and stack
  traces from the underlying tool stay intact and greppable.

EXIT CODES
  0  Clean shutdown (Ctrl-C counts as clean)
  1  Preflight failed
  2  A service died or never became healthy
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) SITE_PORT="${2:?--port needs a value}"; shift 2 ;;
    --debug) DEBUG=1; shift ;;
    --health-timeout) HEALTH_TIMEOUT="${2:?--health-timeout needs a value}"; shift 2 ;;
    --skip-install) SKIP_INSTALL=1; shift ;;
    --fresh) FRESH=1; shift ;;
    --quiet) QUIET=1; shift ;;
    --no-color) NO_COLOR=1; shift ;;
    --clean)
      rm -rf "${LOG_ROOT:?}"
      echo "Removed $LOG_ROOT"
      exit 0
      ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

if [[ -t 1 && "$NO_COLOR" != "1" ]]; then
  C_DIM=$'\033[2m'; C_RED=$'\033[31m'; C_YEL=$'\033[33m'; C_AMB=$'\033[38;5;214m'; C_OFF=$'\033[0m'
else
  C_DIM=""; C_RED=""; C_YEL=""; C_AMB=""; C_OFF=""
fi

mkdir -p "$LOG_DIR"
printf '%s\n' "$LOG_DIR" > "$LOG_ROOT/latest"

ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }

log() {
  local level="$1" component="$2"; shift 2
  local line
  line="$(printf '%s [%-5s] [%-10s] %s' "$(ts)" "$level" "$component" "$*")"
  printf '%s\n' "$line" >> "$RUN_LOG"
  local colour="$C_OFF"
  case "$level" in
    ERROR) colour="$C_RED" ;;
    WARN)  colour="$C_YEL" ;;
    DEBUG) colour="$C_DIM" ;;
    OK)    colour="$C_AMB" ;;
  esac
  printf '%s%s%s\n' "$colour" "$line" "$C_OFF"
}

debug() { [[ "$DEBUG" == "1" ]] && log DEBUG "$@" || true; }

fail() {
  log ERROR "$@"
  exit "${FAIL_CODE:-1}"
}

on_error() {
  local code=$? cmd=$BASH_COMMAND line=${BASH_LINENO[0]}
  [[ "$SHUTTING_DOWN" == "1" ]] && return
  log ERROR runner "run.sh line $line failed (exit $code): $cmd"
  log ERROR runner "Full log: $RUN_LOG"
}
trap on_error ERR

shutdown() {
  [[ "$SHUTTING_DOWN" == "1" ]] && return
  SHUTTING_DOWN=1
  echo
  log INFO runner "Shutting down."
  local i name pid
  for i in "${!SERVICE_PIDS[@]}"; do
    pid="${SERVICE_PIDS[$i]}"
    name="${SERVICE_NAMES[$i]}"
    if kill -0 "$pid" 2>/dev/null; then
      debug runner "Signalling $name (pid $pid)"
      kill "$pid" 2>/dev/null || true
    fi
  done
  for i in "${!SERVICE_PIDS[@]}"; do
    pid="${SERVICE_PIDS[$i]}"
    name="${SERVICE_NAMES[$i]}"
    local waited=0
    while kill -0 "$pid" 2>/dev/null && [[ $waited -lt 10 ]]; do
      sleep 1; waited=$((waited + 1))
    done
    if kill -0 "$pid" 2>/dev/null; then
      log WARN "$name" "Did not stop in ${waited}s — killing."
      kill -9 "$pid" 2>/dev/null || true
    else
      log INFO "$name" "Stopped."
    fi
  done
  for pid in "${MIRROR_PIDS[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
  log INFO runner "Logs for this run: $LOG_DIR"
}
trap shutdown EXIT INT TERM

record_environment() {
  log INFO runner "Mneia local run $RUN_ID"
  log INFO runner "Repo:     $REPO_ROOT"
  log INFO runner "Logs:     $LOG_DIR"
  {
    echo "--- environment ---"
    echo "uname:      $(uname -a 2>/dev/null || echo unknown)"
    echo "bash:       ${BASH_VERSION:-unknown}"
    echo "node:       $(node --version 2>/dev/null || echo MISSING)"
    echo "pnpm:       $(pnpm --version 2>/dev/null || echo MISSING)"
    echo "git branch: $(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
    echo "git sha:    $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
    echo "git dirty:  $(test -n "$(git status --porcelain 2>/dev/null)" && echo yes || echo no)"
    echo "site port:  $SITE_PORT"
    echo "--- end environment ---"
  } >> "$RUN_LOG"
  debug runner "Environment block written to run.log"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail runner "$1 is required but not on PATH. $2"
}

port_is_busy() {
  curl -s -o /dev/null -m 2 "http://localhost:$1/" 2>/dev/null
}

preflight() {
  log INFO preflight "Checking the toolchain."
  require_command node "Install Node 20.11 or newer."
  require_command pnpm "Install pnpm — https://pnpm.io/installation"
  require_command curl "curl is used for health checks."

  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  if [[ "$major" -lt 20 ]]; then
    fail preflight "Node $major is too old. This repo needs Node 20.11 or newer."
  fi
  debug preflight "Node major version $major accepted."

  if port_is_busy "$SITE_PORT"; then
    fail preflight "Something is already answering on port $SITE_PORT. Stop it, or pass --port."
  fi
  debug preflight "Port $SITE_PORT is free."

  if [[ "$FRESH" == "1" ]]; then
    log INFO preflight "Removing apps/site/.next (--fresh)."
    rm -rf "$REPO_ROOT/apps/site/.next"
  elif [[ -f "$REPO_ROOT/apps/site/.next/BUILD_ID" ]]; then
    log WARN preflight "apps/site/.next holds a production build; the dev server will not read it"
    log WARN preflight "cleanly. Removing it — this is what --fresh does explicitly."
    rm -rf "$REPO_ROOT/apps/site/.next"
  fi

  if [[ "$SKIP_INSTALL" == "1" ]]; then
    log INFO preflight "Skipping install (--skip-install)."
  else
    log INFO preflight "Installing dependencies."
    if ! pnpm install --prefer-offline >>"$LOG_DIR/install.log" 2>&1; then
      log ERROR preflight "pnpm install failed. Last 30 lines:"
      tail -n 30 "$LOG_DIR/install.log" | while IFS= read -r l; do log ERROR preflight "  $l"; done
      exit 1
    fi
    debug preflight "Install finished — see install.log"
  fi

  log OK preflight "Preflight passed."
}

start_service() {
  local name="$1" command="$2"
  local service_log="$LOG_DIR/$name.log"

  log INFO "$name" "Starting: $command"
  {
    echo "=== $name started $(ts) ==="
    echo "=== command: $command ==="
  } >> "$service_log"

  bash -c "$command" >>"$service_log" 2>&1 &
  local pid=$!

  SERVICE_NAMES+=("$name")
  SERVICE_PIDS+=("$pid")
  log INFO "$name" "Running as pid $pid — log: $service_log"

  if [[ "$QUIET" != "1" ]]; then
    tail -n 0 -F "$service_log" 2>/dev/null | while IFS= read -r l; do
      printf '%s[%s]%s %s\n' "$C_DIM" "$name" "$C_OFF" "$l"
    done &
    MIRROR_PIDS+=($!)
  fi
}

await_health() {
  local name="$1" url="$2" pid="$3"
  local waited=0
  log INFO "$name" "Waiting for $url (up to ${HEALTH_TIMEOUT}s)."
  while [[ $waited -lt $HEALTH_TIMEOUT ]]; do
    if ! kill -0 "$pid" 2>/dev/null; then
      log ERROR "$name" "Process exited before becoming healthy. Last 40 lines:"
      tail -n 40 "$LOG_DIR/$name.log" | while IFS= read -r l; do log ERROR "$name" "  $l"; done
      FAIL_CODE=2 fail "$name" "Startup failed. Full log: $LOG_DIR/$name.log"
    fi
    if curl -sf -o /dev/null -m 3 "$url" 2>/dev/null; then
      log OK "$name" "Healthy after ${waited}s — $url"
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
    [[ $((waited % 10)) -eq 0 ]] && debug "$name" "Still waiting (${waited}s)."
  done
  log ERROR "$name" "Never answered within ${HEALTH_TIMEOUT}s. Last 40 lines:"
  tail -n 40 "$LOG_DIR/$name.log" | while IFS= read -r l; do log ERROR "$name" "  $l"; done
  FAIL_CODE=2 fail "$name" "Health check timed out. Full log: $LOG_DIR/$name.log"
}

supervise() {
  log OK runner "All services are up."
  log INFO runner "Site:  http://localhost:$SITE_PORT/"
  log INFO runner "Logs:  $LOG_DIR"
  log INFO runner "Press Ctrl-C to stop."
  while true; do
    local i name pid
    for i in "${!SERVICE_PIDS[@]}"; do
      pid="${SERVICE_PIDS[$i]}"
      name="${SERVICE_NAMES[$i]}"
      if ! kill -0 "$pid" 2>/dev/null; then
        log ERROR "$name" "Died unexpectedly. Last 40 lines:"
        tail -n 40 "$LOG_DIR/$name.log" | while IFS= read -r l; do log ERROR "$name" "  $l"; done
        FAIL_CODE=2 fail runner "Service '$name' stopped. Full log: $LOG_DIR/$name.log"
      fi
    done
    sleep 2
  done
}

main() {
  record_environment
  preflight

  start_service "site" "pnpm --filter @mneia/site dev --port $SITE_PORT"
  await_health "site" "http://localhost:$SITE_PORT/" "${SERVICE_PIDS[0]}"

  supervise
}

main "$@"
