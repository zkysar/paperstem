#!/usr/bin/env bash
set -euo pipefail

keychain_get() {
  local name="$1"
  local value
  if ! value="$(security find-generic-password -a "$USER" -s "$name" -w 2>/dev/null)"; then
    echo "with-secrets.sh: missing Keychain entry '$name' (account=$USER)" >&2
    echo "  add it with: security add-generic-password -a \"$USER\" -s $name -w '<value>'" >&2
    exit 1
  fi
  printf '%s' "$value" | tr -d ' \n\r'
}

export GMAIL_USER="${GMAIL_USER:-zach.kysar@gmail.com}"
export GMAIL_APP_PASSWORD="${GMAIL_APP_PASSWORD:-$(keychain_get PAPER_STEM_APP_CODE)}"
export GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-$(keychain_get PAPERSTEM_GOOGLE_CLIENT_ID)}"
export GOOGLE_CLIENT_SECRET="${GOOGLE_CLIENT_SECRET:-$(keychain_get PAPERSTEM_GOOGLE_CLIENT_SECRET)}"
export GOOGLE_REFRESH_TOKEN="${GOOGLE_REFRESH_TOKEN:-$(keychain_get PAPERSTEM_GOOGLE_REFRESH_TOKEN)}"

export APP_URL="${APP_URL:-http://localhost:5173}"
export DATABASE_PATH="${DATABASE_PATH:-./dev.sqlite}"
export PORT="${PORT:-8787}"
export SESSION_COOKIE_SECRET="${SESSION_COOKIE_SECRET:-dev-only-not-secret-replace-in-prod}"

exec "$@"
