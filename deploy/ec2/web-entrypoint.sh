#!/bin/sh
set -eu

persist_dir="${PERSIST_DIR:-/data}"
config_dir="${XDG_CONFIG_HOME:-/tmp/quantscope/config}"
port="${PORT:-8791}"

mkdir -p "$persist_dir" "$config_dir"

exec node /app/node_modules/wrangler/bin/wrangler.js dev \
  --config /app/.scanner-worker.jsonc \
  --ip 0.0.0.0 \
  --port "$port" \
  --local \
  --persist-to "$persist_dir" \
  --log-level warn \
  --show-interactive-dev-session false
