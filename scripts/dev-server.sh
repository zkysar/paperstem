#!/usr/bin/env bash
set -euo pipefail
export GMAIL_USER="zach.kysar@gmail.com"
export GMAIL_APP_PASSWORD="$(security find-generic-password -a "$USER" -s PAPER_STEM_APP_CODE -w | tr -d ' ')"
export APP_URL="${APP_URL:-http://localhost:5173}"
export DATABASE_PATH="${DATABASE_PATH:-./dev.sqlite}"
export PORT="${PORT:-8787}"
export SESSION_COOKIE_SECRET="${SESSION_COOKIE_SECRET:-dev-only-not-secret-replace-in-prod}"
exec npx tsx watch src/server/index.ts
