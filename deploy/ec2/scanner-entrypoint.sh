#!/bin/sh
set -eu

log() {
  printf '%s %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"
}

require_value() {
  variable_name="$1"
  eval "variable_value=\${$variable_name:-}"
  if [ -z "$variable_value" ]; then
    log "Missing required configuration: $variable_name"
    exit 1
  fi
}

secret_file="${SCANNER_SECRET_FILE:-/run/secrets/scanner_env}"
if [ ! -r "$secret_file" ]; then
  log "Scanner secret file is not readable."
  exit 1
fi

set -a
# The file is supplied by Docker secrets and is never copied into the image.
. "$secret_file"
set +a

require_value FASTACT_EMAIL_SENDER
require_value FASTACT_EMAIL_APP_PASSWORD
require_value FASTACT_EMAIL_RECIPIENT

sites_sync_enabled="${SITES_SYNC_ENABLED:-false}"
case "$(printf '%s' "$sites_sync_enabled" | tr '[:upper:]' '[:lower:]')" in
  1|true|yes|on)
    sites_sync_enabled="true"
    require_value SCANNER_TRIGGER_KEY
    require_value SITES_SYNC_BEARER_TOKEN
    require_value SITES_SYNC_URL
    ;;
  *) sites_sync_enabled="false" ;;
esac

if [ "${BINANCE_FUTURES_TRADING_ENABLED:-false}" = "true" ]; then
  require_value BINANCE_API_KEY
  require_value BINANCE_API_SECRET
  require_value BINANCE_FUTURES_DEMO_ONLY
  require_value BINANCE_FUTURES_BASE_URL
fi

if [ "$sites_sync_enabled" = "true" ]; then
  case "$SITES_SYNC_URL" in
    https://*/api/scanner/sync) ;;
    *)
      log "SITES_SYNC_URL must be an HTTPS scanner sync endpoint."
      exit 1
      ;;
  esac
fi

port="${PORT:-8791}"
bind_address="${BIND_ADDRESS:-127.0.0.1}"
persist_dir="${PERSIST_DIR:-/data}"
runtime_dir="/tmp/quantscope"
worker_env="$runtime_dir/worker.env"
status_file="$runtime_dir/status.json"
sync_file="$runtime_dir/sync.json"
wrangler="/app/node_modules/wrangler/bin/wrangler.js"
config="/app/.scanner-worker.jsonc"

mkdir -p "$persist_dir" "$runtime_dir" "$XDG_CONFIG_HOME"

node --input-type=module - "$worker_env" <<'NODE'
import { writeFileSync } from "node:fs";

const output = process.argv[2];
const keys = [
  "FASTACT_EMAIL_SENDER",
  "FASTACT_EMAIL_APP_PASSWORD",
  "FASTACT_EMAIL_RECIPIENT",
  "SCANNER_TRIGGER_KEY",
  "ALGORITHM_EXECUTION_ENABLED",
  "SCANNER_SINGLE_TICK",
  "SCANNER_CONCURRENCY",
  "BINANCE_API_KEY",
  "BINANCE_API_SECRET",
  "BINANCE_FUTURES_BASE_URL",
  "BINANCE_FUTURES_TRADING_ENABLED",
  "BINANCE_FUTURES_DEMO_ONLY",
  "BINANCE_FUTURES_MARGIN_USDT",
];
const content = keys
  .map((key) => `${key}=${JSON.stringify(process.env[key] ?? "")}`)
  .join("\n");
writeFileSync(output, `${content}\n`, { encoding: "utf8", mode: 0o600 });
NODE

worker_pid=""
stop_worker() {
  if [ -n "$worker_pid" ] && kill -0 "$worker_pid" 2>/dev/null; then
    kill -TERM "$worker_pid" 2>/dev/null || true
    wait "$worker_pid" 2>/dev/null || true
  fi
}
trap stop_worker INT TERM EXIT

node "$wrangler" dev \
  --config "$config" \
  --ip "$bind_address" \
  --port "$port" \
  --local \
  --test-scheduled \
  --persist-to "$persist_dir" \
  --env-file "$worker_env" \
  --log-level warn \
  --show-interactive-dev-session false &
worker_pid="$!"

ready=0
attempt=1
while [ "$attempt" -le 45 ]; do
  if ! kill -0 "$worker_pid" 2>/dev/null; then
    wait "$worker_pid"
    exit $?
  fi
  if curl --fail --silent --max-time 3 \
    "http://127.0.0.1:$port/api/scanner" >/dev/null; then
    ready=1
    break
  fi
  sleep 1
  attempt=$((attempt + 1))
done

if [ "$ready" -ne 1 ]; then
  log "Scanner worker did not become ready."
  exit 1
fi
log "QuantScope scanner is ready."

run_cycle() {
  curl --fail --silent --show-error --max-time 240 \
    "http://127.0.0.1:$port/__scheduled" >/dev/null || return 10

  status_ready=0
  status_attempt=1
  while [ "$status_attempt" -le 30 ]; do
    if curl --fail --silent --show-error --max-time 5 \
      "http://127.0.0.1:$port/api/scanner" \
      --output "$status_file"; then
      status_ready=1
      break
    fi
    sleep 2
    status_attempt=$((status_attempt + 1))
  done
  if [ "$status_ready" -ne 1 ]; then
    log "Scanner status did not become readable after the tick."
    return 11
  fi
  jq -e '.config and .intervals and .leaders and .paper' \
    "$status_file" >/dev/null || return 12

  if [ "$sites_sync_enabled" = "true" ]; then
    curl --fail --silent --show-error --max-time 30 \
      --retry 2 \
      --retry-delay 2 \
      --retry-all-errors \
      --request POST \
      --header "Accept: application/json" \
      --header "Content-Type: application/json" \
      --header "OAI-Sites-Authorization: Bearer $SITES_SYNC_BEARER_TOKEN" \
      --header "X-QuantScope-Trigger: $SCANNER_TRIGGER_KEY" \
      --data-binary "@$status_file" \
      --output "$sync_file" \
      "$SITES_SYNC_URL" || return 20
    jq -e '.ok == true' "$sync_file" >/dev/null || return 21
  fi

  scans="$(jq -r '.config.scans_completed // 0' "$status_file")"
  alerts="$(jq -r '.config.alerts_sent // 0' "$status_file")"
  open_positions="$(jq -r '.paper.openPositions | length' "$status_file")"
  log "cycle complete; scans=$scans alerts=$alerts open_positions=$open_positions"
}

consecutive_worker_failures=0
max_worker_failures=4

while true; do
  if ! kill -0 "$worker_pid" 2>/dev/null; then
    wait "$worker_pid"
    exit $?
  fi

  now="$(date +%s)"
  delay=$((15 - (now % 15)))
  sleep "$delay"

  if run_cycle; then
    consecutive_worker_failures=0
  else
    cycle_result="$?"
    case "$cycle_result" in
      20|21)
        # Remote state sync must not restart an otherwise healthy scanner.
        consecutive_worker_failures=0
        log "remote sync failed; the local scanner will keep running."
        ;;
      *)
        consecutive_worker_failures=$((consecutive_worker_failures + 1))
        log "local cycle failed ($consecutive_worker_failures/$max_worker_failures); state is preserved."
        if [ "$consecutive_worker_failures" -ge "$max_worker_failures" ]; then
          log "scanner worker stayed unavailable; exiting so Docker can restart it."
          exit 1
        fi
        ;;
    esac
    sleep 5
  fi
done
