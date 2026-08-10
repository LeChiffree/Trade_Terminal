#!/bin/sh
set -eu

persist_dir="${PERSIST_DIR:-/data}"
config_dir="${XDG_CONFIG_HOME:-/tmp/quantscope/config}"
port="${PORT:-8791}"
secret_file="${SCANNER_SECRET_FILE:-/run/secrets/scanner_env}"
runtime_dir="/tmp/quantscope"
worker_env="$runtime_dir/web.env"

if [ ! -r "$secret_file" ]; then
  echo "Web runtime secret file is not readable." >&2
  exit 1
fi

set -a
. "$secret_file"
set +a

mkdir -p "$persist_dir" "$config_dir" "$runtime_dir"

node --input-type=module - "$worker_env" <<'NODE'
import { writeFileSync } from "node:fs";

const output = process.argv[2];
const keys = [
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "FASTACT_EMAIL_SENDER",
  "FASTACT_EMAIL_APP_PASSWORD",
  "FASTACT_EMAIL_RECIPIENT",
  "SITES_SYNC_BEARER_TOKEN",
  "SCANNER_STATUS_UPSTREAM_URL",
  "BIST_PAPER_STATUS_UPSTREAM_URL",
];
const content = keys
  .map((key) => `${key}=${JSON.stringify(process.env[key] ?? "")}`)
  .join("\n");
writeFileSync(output, `${content}\n`, { encoding: "utf8", mode: 0o600 });
NODE

exec node /app/node_modules/wrangler/bin/wrangler.js dev \
  --config /app/.scanner-worker.jsonc \
  --ip 0.0.0.0 \
  --port "$port" \
  --local \
  --persist-to "$persist_dir" \
  --env-file "$worker_env" \
  --log-level warn \
  --show-interactive-dev-session false
