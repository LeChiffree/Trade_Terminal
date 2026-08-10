#!/bin/sh
set -eu

source_env="${1:-$HOME/.quantscope-env-upload}"
source_service="${2:-$HOME/.quantscope-service-upload}"
destination="${3:-/opt/quantscope/secrets/scanner.env}"

if [ ! -r "$source_env" ] || [ ! -r "$source_service" ]; then
  echo "Encrypted transport uploads are missing or unreadable." >&2
  exit 1
fi

set -a
# The upload is the ignored local .env.local file and is removed below.
. "$source_env"
set +a

SCANNER_TRIGGER_KEY="$(
  sed -n 's/^[[:space:]]*"X-QuantScope-Trigger"[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' \
    "$source_service" | head -n 1
)"
SITES_SYNC_BEARER_TOKEN="$(
  sed -n 's/^[[:space:]]*"OAI-Sites-Authorization"[[:space:]]*=[[:space:]]*"Bearer \([^"]*\)".*/\1/p' \
    "$source_service" | head -n 1
)"

required_values="
FASTACT_EMAIL_SENDER
FASTACT_EMAIL_APP_PASSWORD
FASTACT_EMAIL_RECIPIENT
SCANNER_TRIGGER_KEY
SITES_SYNC_BEARER_TOKEN
BINANCE_API_KEY
BINANCE_API_SECRET
BINANCE_FUTURES_BASE_URL
BINANCE_FUTURES_TRADING_ENABLED
BINANCE_FUTURES_DEMO_ONLY
BINANCE_FUTURES_MARGIN_USDT
"
for variable_name in $required_values; do
  eval "variable_value=\${$variable_name:-}"
  if [ -z "$variable_value" ]; then
    echo "Required scanner secret is missing: $variable_name" >&2
    exit 1
  fi
done

if [ "$BINANCE_FUTURES_BASE_URL" != "https://demo-fapi.binance.com" ] ||
   [ "$BINANCE_FUTURES_DEMO_ONLY" != "true" ]; then
  echo "Only Binance USD-M Futures Demo credentials are accepted." >&2
  exit 1
fi

umask 077
temporary_file="$(mktemp)"
cleanup() {
  rm -f "$temporary_file"
}
trap cleanup EXIT INT TERM

{
  printf 'FASTACT_EMAIL_SENDER=%s\n' "$FASTACT_EMAIL_SENDER"
  printf 'FASTACT_EMAIL_APP_PASSWORD=%s\n' "$FASTACT_EMAIL_APP_PASSWORD"
  printf 'FASTACT_EMAIL_RECIPIENT=%s\n' "$FASTACT_EMAIL_RECIPIENT"
  printf 'SCANNER_TRIGGER_KEY=%s\n' "$SCANNER_TRIGGER_KEY"
  printf 'SITES_SYNC_BEARER_TOKEN=%s\n' "$SITES_SYNC_BEARER_TOKEN"
  printf 'BINANCE_API_KEY=%s\n' "$BINANCE_API_KEY"
  printf 'BINANCE_API_SECRET=%s\n' "$BINANCE_API_SECRET"
  printf 'BINANCE_FUTURES_BASE_URL=%s\n' "$BINANCE_FUTURES_BASE_URL"
  printf 'BINANCE_FUTURES_TRADING_ENABLED=%s\n' "$BINANCE_FUTURES_TRADING_ENABLED"
  printf 'BINANCE_FUTURES_DEMO_ONLY=%s\n' "$BINANCE_FUTURES_DEMO_ONLY"
  printf 'BINANCE_FUTURES_MARGIN_USDT=%s\n' "$BINANCE_FUTURES_MARGIN_USDT"
} > "$temporary_file"

sudo install -d -m 0700 "$(dirname "$destination")"
sudo install -m 0600 -o root -g root "$temporary_file" "$destination"
rm -f "$source_env" "$source_service"

echo "Scanner secret installed with root-only permissions."
